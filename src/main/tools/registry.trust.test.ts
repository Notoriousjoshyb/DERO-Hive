import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpManager } from '../mcp/manager';
import type { PermissionRequest, ToolRegistry as ToolRegistryClass } from './registry';

// Trust-gating + audit-trail tests for ToolRegistry (GAP_ANALYSIS 1C/1D).
// A temp HIVE_DATA_DIR must be in place before the db modules initialize, so
// they are imported dynamically inside main() (the root package is CJS, so no
// top-level await here — the cli test suite gets away with it via "type":
// "module" in cli/package.json).
const dataDir = mkdtempSync(join(tmpdir(), 'hive-registry-trust-'));
const untrustedDir = join(dataDir, 'proj-untrusted');
const trustedDir = join(dataDir, 'proj-trusted');
const standardDir = join(dataDir, 'proj-standard'); // no projects row → trust defaults to 'standard'
mkdirSync(untrustedDir);
mkdirSync(trustedDir);
mkdirSync(standardDir);
process.env.HIVE_DATA_DIR = dataDir;
process.env.HIVE_CLI = '1';

type Registry = InstanceType<typeof ToolRegistryClass>;

interface AuditRow {
  id: string;
  conversation_id: string | null;
  tool: string;
  args_redacted: string;
  decision: string;
  duration_ms: number;
  status: string;
  files_touched: string;
  created_at: number;
}

async function main(): Promise<number> {
  const { initDb, closeDb, getDb, setSetting } = await import('../db/client');
  const { ToolRegistry } = await import('./registry');

  let tools: Registry;

  const tests: Array<[string, () => void | Promise<void>]> = [];

  const setMode = (mode: 'always' | 'session' | 'project' | 'never'): void => {
    setSetting('appSettings', { toolApprovalMode: mode });
  };

  /** Auto-decide every permission prompt and record which tool names prompted. */
  const watchPrompts = (registry: Registry, decision: 'allow' | 'deny'): { prompts: string[]; stop: () => void } => {
    const prompts: string[] = [];
    const handler = (req: PermissionRequest): void => {
      prompts.push(req.toolName);
      registry.decidePermission(req.requestId, decision);
    };
    registry.on('request', handler);
    return { prompts, stop: () => registry.off('request', handler) };
  };

  const auditRows = (conversationId: string): AuditRow[] =>
    getDb().prepare('SELECT * FROM tool_executions WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as AuditRow[];

  // --- 1C: untrusted projects force an explicit ask for every tool ---------

  tests.push(['untrusted + mode never still prompts (autopilot ignored)', async () => {
    setMode('never');
    const w = watchPrompts(tools, 'deny');
    try {
      const res = await tools.execute('read_file', { path: 'x.txt' }, { cwd: untrustedDir, conversationId: 'c-never' });
      assert.deepEqual(w.prompts, ['read_file']);
      assert.match(res.content, /User denied/);
    } finally { w.stop(); }
  }]);

  tests.push(['untrusted downgrades persisted allow rules to ask', async () => {
    tools.saveRule({ id: randomUUID(), toolName: 'write_file', action: 'allow', scope: 'global' });
    setMode('always');
    const w = watchPrompts(tools, 'deny');
    try {
      const res = await tools.execute('write_file', { path: 'a.txt', content: 'x' }, { cwd: untrustedDir, conversationId: 'c-allow-downgrade' });
      assert.deepEqual(w.prompts, ['write_file']);
      assert.match(res.content, /User denied/);
    } finally { w.stop(); }
  }]);

  // Provider-native callbacks (codex-acp) enter via requestPermission rather
  // than execute, so the trust gate has to be enforced there too.
  tests.push(['untrusted forces an ask on the requestPermission path', async () => {
    tools.saveRule({ id: randomUUID(), toolName: 'write_file', action: 'allow', scope: 'global' });
    setMode('never');
    const w = watchPrompts(tools, 'deny');
    try {
      const allowed = await tools.requestPermission(
        { requestId: randomUUID(), toolName: 'write_file', args: { path: 'a.txt', content: 'x' } },
        { cwd: untrustedDir, conversationId: 'c-req-perm' }
      );
      assert.deepEqual(w.prompts, ['write_file']);
      assert.equal(allowed, false);
    } finally { w.stop(); }
  }]);

  tests.push(['trusted project keeps requestPermission allow-rule fast path', async () => {
    tools.saveRule({ id: randomUUID(), toolName: 'write_file', action: 'allow', scope: 'global' });
    setMode('always');
    const w = watchPrompts(tools, 'deny');
    try {
      const allowed = await tools.requestPermission(
        { requestId: randomUUID(), toolName: 'write_file', args: { path: 'a.txt', content: 'x' } },
        { cwd: trustedDir, conversationId: 'c-req-perm-trusted' }
      );
      assert.deepEqual(w.prompts, []);
      assert.equal(allowed, true);
    } finally { w.stop(); }
  }]);

  tests.push(['untrusted still honors persisted deny rules outright', async () => {
    tools.saveRule({ id: randomUUID(), toolName: 'edit_file', action: 'deny', scope: 'global' });
    const w = watchPrompts(tools, 'allow');
    try {
      const res = await tools.execute('edit_file', { path: 'a.txt', old_text: 'x', new_text: 'y' }, { cwd: untrustedDir, conversationId: 'c-deny' });
      assert.match(res.content, /Denied by permission rule/);
      assert.deepEqual(w.prompts, []); // outright deny — no prompt
    } finally { w.stop(); }
  }]);

  tests.push(['untrusted ignores remembered session grants', async () => {
    setMode('session');
    const w = watchPrompts(tools, 'allow');
    try {
      await tools.execute('run_shell', { command: 'echo one' }, { cwd: untrustedDir, conversationId: 'c-grant-u' });
      await tools.execute('run_shell', { command: 'echo two' }, { cwd: untrustedDir, conversationId: 'c-grant-u' });
      // Both executions prompted — an untrusted project never records a grant.
      assert.deepEqual(w.prompts, ['run_shell', 'run_shell']);
    } finally { w.stop(); }
  }]);

  // --- 'standard' / 'trusted' keep current behavior ------------------------

  tests.push(['standard project keeps session-grant behavior', async () => {
    setMode('session');
    const w = watchPrompts(tools, 'allow');
    try {
      await tools.execute('run_shell', { command: 'echo one' }, { cwd: standardDir, conversationId: 'c-grant-s' });
      await tools.execute('run_shell', { command: 'echo two' }, { cwd: standardDir, conversationId: 'c-grant-s' });
      assert.deepEqual(w.prompts, ['run_shell']); // second call rides the remembered grant
    } finally { w.stop(); }
  }]);

  tests.push(['trusted project + mode never does not prompt', async () => {
    setMode('never');
    const w = watchPrompts(tools, 'deny');
    try {
      const res = await tools.execute('read_file', { path: 'x.txt' }, { cwd: trustedDir, conversationId: 'c-trusted-never' });
      assert.deepEqual(w.prompts, []);
      assert.match(res.content, /file not found/); // executed (and failed) without asking
    } finally { w.stop(); }
  }]);

  tests.push(['trusted project honors persisted allow rules', async () => {
    setMode('always'); // write_file has a global allow rule from an earlier test
    const w = watchPrompts(tools, 'deny');
    try {
      const res = await tools.execute('write_file', { path: 'b.txt', content: 'x' }, { cwd: trustedDir, conversationId: 'c-trusted-allow' });
      assert.deepEqual(w.prompts, []);
      assert.equal(res.isError, undefined);
    } finally { w.stop(); }
  }]);

  // --- Approval coverage: media/scaffold/wallet + trusted MCP writes -------

  tests.push(['media/scaffold/wallet tools now prompt', async () => {
    setMode('always');
    const gated = ['generate_tela_dapp', 'generate_image', 'generate_audio', 'generate_video', 'simulator_create_wallet'];
    const w = watchPrompts(tools, 'deny'); // deny so nothing actually runs
    try {
      for (const name of gated) {
        const res = await tools.execute(name, { prompt: 'x' }, { cwd: standardDir, conversationId: `c-media-${name}` });
        assert.match(res.content, /User denied/, `${name} should have prompted`);
      }
      assert.deepEqual(w.prompts, gated);
    } finally { w.stop(); }
  }]);

  tests.push(['trusted MCP server prompts for write-named tools only', async () => {
    const fakeMcp = {
      getAllTools: () => [],
      resolveTool: (name: string) => ({ serverId: 'srv1', serverName: 'FakeSrv', toolName: name, trusted: true }),
      callTool: async () => ({ content: 'ok' })
    } as unknown as McpManager;
    const mcpTools = new ToolRegistry(fakeMcp);
    setMode('always');

    const w = watchPrompts(mcpTools, 'allow');
    try {
      const res = await mcpTools.execute('transfer_funds', { amount: 5 }, { cwd: standardDir, conversationId: 'c-mcp-write' });
      assert.deepEqual(w.prompts, ['transfer_funds']); // write heuristic fires even on a trusted server
      assert.equal(res.content, 'ok');
    } finally { w.stop(); }

    const w2 = watchPrompts(mcpTools, 'deny');
    try {
      const res = await mcpTools.execute('read_data', {}, { cwd: standardDir, conversationId: 'c-mcp-read' });
      assert.deepEqual(w2.prompts, []); // trusted + read-only → no prompt
      assert.equal(res.content, 'ok');
    } finally { w2.stop(); }
  }]);

  // --- 1D: audit trail ------------------------------------------------------

  tests.push(['audit row: success with redacted args + resolved file', async () => {
    setMode('never'); // standard trust → no prompt
    const res = await tools.execute(
      'write_file',
      { path: 'audit.txt', content: 'hello', api_key: 'sk-FAKEFAKEFAKEFAKE1234567890' },
      { cwd: standardDir, conversationId: 'c-audit-ok' }
    );
    assert.equal(res.isError, undefined);
    const rows = auditRows('c-audit-ok');
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row.id);
    assert.equal(row.tool, 'write_file');
    assert.equal(row.decision, 'allow');
    assert.equal(row.status, 'success');
    assert.equal(typeof row.duration_ms, 'number');
    assert.ok(row.created_at > 0);
    assert.ok(!row.args_redacted.includes('sk-FAKEFAKEFAKEFAKE1234567890'), 'secret must be redacted');
    assert.ok(row.args_redacted.includes('"api_key":"[REDACTED]"'));
    const files = JSON.parse(row.files_touched) as string[];
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('audit.txt'));
  }]);

  tests.push(['audit row: denial maps to deny/denied', async () => {
    // edit_file has a global deny rule from an earlier test → outright denial.
    const res = await tools.execute('edit_file', { path: 'audit.txt', old_text: 'a', new_text: 'b' }, { cwd: standardDir, conversationId: 'c-audit-deny' });
    assert.match(res.content, /Denied by permission rule/);
    const rows = auditRows('c-audit-deny');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decision, 'deny');
    assert.equal(rows[0].status, 'denied');
    // Denied write attempts still record the intended target file.
    assert.ok((JSON.parse(rows[0].files_touched) as string[])[0].endsWith('audit.txt'));
  }]);

  tests.push(['audit row: execution error maps to allow/error', async () => {
    setMode('never');
    const res = await tools.execute('read_file', { path: 'missing.txt' }, { cwd: standardDir, conversationId: 'c-audit-err' });
    assert.equal(res.isError, true);
    const rows = auditRows('c-audit-err');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decision, 'allow');
    assert.equal(rows[0].status, 'error');
    assert.equal(rows[0].files_touched, '[]');
  }]);

  // --- Setup + runner -------------------------------------------------------

  let failed = 0;
  try {
    await initDb();
    tools = new ToolRegistry(null);

    const insertProject = (id: string, path: string, trust: string): void => {
      getDb().prepare(`
        INSERT INTO projects (id, name, path, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, id, path, JSON.stringify({ trust }), Date.now(), Date.now());
    };
    insertProject('p-untrusted', untrustedDir, 'untrusted');
    insertProject('p-trusted', trustedDir, 'trusted');

    let passed = 0;
    for (const [name, fn] of tests) {
      try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failed++;
        console.error(`  ✗ ${name}\n    ${(error as Error).stack ?? error}`);
      }
    }
    console.log(`\nregistry.trust.test.ts — ${passed} passed, ${failed} failed`);
  } finally {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  }
  return failed;
}

// Pending auto-deny timers are unref'd, but exit explicitly to be sure.
main().then((failed) => process.exit(failed > 0 ? 1 : 0));
