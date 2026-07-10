import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { McpManager } from '../src/main/mcp/manager';

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

describe('"don\'t ask again" session grant', () => {
  test('is scoped to the tool it was granted for', async () => {
    const reg = makeRegistry(fakeMcp(true));
    const prompts: string[] = [];
    reg.on('request', (req: { requestId: string; toolName: string }) => {
      prompts.push(req.toolName);
      // Remember only for write_file.
      setImmediate(() => reg.decidePermission(req.requestId, 'allow', req.toolName === 'write_file'));
    });

    await reg.execute('write_file', { path: 'a' }, ctx);
    await reg.execute('write_file', { path: 'b' }, ctx); // granted — must not ask again
    await reg.execute('run_shell', { command: 'whoami' }, ctx); // must still ask

    expect(prompts).toEqual(['write_file', 'run_shell']);
  });

  test('does not survive into a fresh registry', async () => {
    const first = makeRegistry(fakeMcp(true));
    first.on('request', (req: { requestId: string }) =>
      setImmediate(() => first.decidePermission(req.requestId, 'allow', true))
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
