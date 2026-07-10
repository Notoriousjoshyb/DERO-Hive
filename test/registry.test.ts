import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { McpManager } from '../src/main/mcp/manager';
import { normalizeToolApprovalMode } from '../src/shared/types';

// The permissions table is empty in these scenarios; approval is decided by
// requiresApproval() and the MCP trust flag.
const rules: unknown[] = [];
let appSettings: Record<string, unknown> = { toolApprovalMode: 'always' };

vi.mock('../src/main/db/client', () => ({
  getDb: () => ({ prepare: () => ({ all: () => rules, get: () => undefined, run: () => {} }) }),
  getSetting: (key: string) => (key === 'appSettings' ? appSettings : undefined)
}));

// Gating is the unit under test, not the tools themselves — a real run_shell
// would execute a command and a real write_file would touch the disk.
vi.mock('../src/main/tools/builtin', () => ({
  BUILTIN_TOOLS: [{ name: 'read_file' }, { name: 'write_file' }, { name: 'run_shell' }],
  builtinExecutors: {
    read_file: async () => ({ content: 'read' }),
    write_file: async () => ({ content: 'wrote' }),
    run_shell: async () => ({ content: 'ran' })
  }
}));

const { ToolRegistry } = await import('../src/main/tools/registry');

const ctx = { cwd: process.cwd(), conversationId: 'c1' };

/** An MCP manager exposing one tool, owned by a server of the given trust. */
function fakeMcp(trusted: boolean) {
  const calls: Array<{ serverId: string; toolName: string }> = [];
  const manager = {
    calls,
    getAllTools: () => [
      { name: 'dero_get_info', description: '', parameters: {}, source: 'mcp:bundled-dero' }
    ],
    resolveTool(name: string) {
      if (name.startsWith('mcp:')) {
        const [, serverId, ...rest] = name.split(':');
        return serverId === 'bundled-dero'
          ? { serverId, toolName: rest.join(':'), trusted }
          : null;
      }
      return name === 'dero_get_info'
        ? { serverId: 'bundled-dero', toolName: name, trusted }
        : null;
    },
    async callTool(serverId: string, toolName: string) {
      calls.push({ serverId, toolName });
      return { content: [{ type: 'text', text: 'height=1234' }], isError: false };
    }
  };
  return manager;
}

const makeRegistry = (mcp: ReturnType<typeof fakeMcp>) =>
  new ToolRegistry(mcp as unknown as McpManager);

beforeEach(() => {
  appSettings = { toolApprovalMode: 'always' };
  rules.length = 0;
});

describe('MCP tool routing', () => {
  test('routes a tool called by its raw advertised name', async () => {
    const mcp = fakeMcp(true);
    const result = await makeRegistry(mcp).execute('dero_get_info', {}, ctx);

    expect(mcp.calls).toEqual([{ serverId: 'bundled-dero', toolName: 'dero_get_info' }]);
    expect(result.content).toBe('height=1234');
  });

  test('also accepts the explicit mcp:<server>:<tool> form', async () => {
    const mcp = fakeMcp(true);
    await makeRegistry(mcp).execute('mcp:bundled-dero:dero_get_info', {}, ctx);

    expect(mcp.calls).toEqual([{ serverId: 'bundled-dero', toolName: 'dero_get_info' }]);
  });

  test('reports an unknown tool', async () => {
    const result = await makeRegistry(fakeMcp(true)).execute('not_a_tool', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Unknown tool/);
  });
});

describe('MCP trust gating', () => {
  test('a tool from a trusted server runs without asking', async () => {
    const reg = makeRegistry(fakeMcp(true));
    const prompts: string[] = [];
    reg.on('request', (req: { toolName: string }) => prompts.push(req.toolName));

    await reg.execute('dero_get_info', {}, ctx);

    expect(prompts).toEqual([]);
  });

  test('a tool from an untrusted server asks first', async () => {
    const mcp = fakeMcp(false);
    const reg = makeRegistry(mcp);
    const prompts: string[] = [];
    reg.on('request', (req: { requestId: string; toolName: string }) => {
      prompts.push(req.toolName);
      setImmediate(() => reg.decidePermission(req.requestId, 'allow'));
    });

    const result = await reg.execute('dero_get_info', {}, ctx);

    expect(prompts).toEqual(['dero_get_info']);
    expect(result.content).toBe('height=1234');
  });

  test('denying an untrusted tool blocks it from running at all', async () => {
    const mcp = fakeMcp(false);
    const reg = makeRegistry(mcp);
    reg.on('request', (req: { requestId: string }) =>
      setImmediate(() => reg.decidePermission(req.requestId, 'deny'))
    );

    const result = await reg.execute('dero_get_info', {}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/User denied/);
    expect(mcp.calls).toEqual([]);
  });
});

describe('explicit permission rules', () => {
  test('allow and deny override the global approval mode', async () => {
    const reg = makeRegistry(fakeMcp(true));
    let prompts = 0;
    reg.on('request', () => { prompts++; });

    appSettings = { toolApprovalMode: 'always' };
    rules.push({ id: 'allow-write', tool_name: 'write_file', action: 'allow' });
    expect((await reg.execute('write_file', {}, ctx)).content).toBe('wrote');

    rules.length = 0;
    appSettings = { toolApprovalMode: 'never' };
    rules.push({ id: 'deny-write', tool_name: 'write_file', action: 'deny' });
    expect((await reg.execute('write_file', {}, ctx)).isError).toBe(true);
    expect(prompts).toBe(0);
  });
});

describe('per-chat session grant', () => {
  test('is scoped to the tool it was granted for', async () => {
    appSettings = { toolApprovalMode: 'session' };
    const reg = makeRegistry(fakeMcp(true));
    const prompts: string[] = [];
    reg.on('request', (req: { requestId: string; toolName: string }) => {
      prompts.push(req.toolName);
      setImmediate(() => reg.decidePermission(req.requestId, 'allow'));
    });

    await reg.execute('write_file', { path: 'a' }, ctx);
    await reg.execute('write_file', { path: 'b' }, ctx); // granted — must not ask again
    await reg.execute('write_file', { path: 'c' }, { ...ctx, conversationId: 'c2' }); // different chat — must ask
    await reg.execute('run_shell', { command: 'whoami' }, ctx); // must still ask

    expect(prompts).toEqual(['write_file', 'write_file', 'run_shell']);
  });

  test('does not survive into a fresh registry', async () => {
    appSettings = { toolApprovalMode: 'session' };
    const first = makeRegistry(fakeMcp(true));
    first.on('request', (req: { requestId: string }) =>
      setImmediate(() => first.decidePermission(req.requestId, 'allow'))
    );
    await first.execute('write_file', { path: 'a' }, ctx);

    const second = makeRegistry(fakeMcp(true));
    let asked = false;
    second.on('request', (req: { requestId: string }) => {
      asked = true;
      setImmediate(() => second.decidePermission(req.requestId, 'allow'));
    });
    await second.execute('write_file', { path: 'a' }, ctx);

    expect(asked).toBe(true);
  });

  test('is scoped to both conversation and tool', async () => {
    appSettings = { toolApprovalMode: 'session' };
    const reg = makeRegistry(fakeMcp(true));
    const prompts: string[] = [];
    reg.on('request', (req: { requestId: string; toolName: string; conversationId: string }) => {
      prompts.push(`${req.conversationId}:${req.toolName}`);
      setImmediate(() => reg.decidePermission(req.requestId, 'allow'));
    });

    await reg.execute('write_file', {}, { ...ctx, conversationId: 'c1' });
    await reg.execute('write_file', {}, { ...ctx, conversationId: 'c1' });
    await reg.execute('write_file', {}, { ...ctx, conversationId: 'c2' });

    expect(prompts).toEqual(['c1:write_file', 'c2:write_file']);
  });

  test('an explicit ask rule still prompts after a session grant', async () => {
    appSettings = { toolApprovalMode: 'session' };
    const reg = makeRegistry(fakeMcp(true));
    let prompts = 0;
    reg.on('request', (req: { requestId: string }) => {
      prompts++;
      setImmediate(() => reg.decidePermission(req.requestId, 'allow'));
    });

    await reg.execute('write_file', {}, ctx);
    rules.push({ id: 'ask-write', tool_name: 'write_file', action: 'ask' });
    await reg.execute('write_file', {}, ctx);

    expect(prompts).toBe(2);
  });

  test('toolApprovalMode "never" skips prompting entirely', async () => {
    appSettings = { toolApprovalMode: 'never' };
    const reg = makeRegistry(fakeMcp(true));
    let asked = false;
    reg.on('request', () => { asked = true; });

    const result = await reg.execute('write_file', { path: 'a' }, ctx);

    expect(asked).toBe(false);
    expect(result.content).toBe('wrote');
  });
});

test('preserves the project approval mode', () => {
  expect(normalizeToolApprovalMode('project')).toBe('project');
  expect(normalizeToolApprovalMode('garbage')).toBe('always');
});
