import { describe, test, expect, vi, beforeEach } from 'vitest';

// Capture what the native dialog was asked, and control what the user answers.
const shown: Array<{ message: string; detail: string }> = [];
let approve = true;

vi.mock('electron', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    dialog: {
      showMessageBox: async (a: unknown, b?: unknown) => {
        shown.push((b ?? a) as { message: string; detail: string });
        return { response: approve ? 1 : 0 };
      }
    }
  };
});

const { confirmServerLaunch } = await import('../src/main/ipc/mcp');

type Cfg = Parameters<typeof confirmServerLaunch>[1];

const managerWith = (configs: Cfg[]) =>
  ({ listConfigs: async () => configs }) as unknown as Parameters<typeof confirmServerLaunch>[0];

const NEW_SERVER = {
  id: 'x',
  name: 'Some Server',
  command: 'C:/tools/thing.exe',
  args: ['--serve'],
  enabled: true
} as Cfg;

const confirm = (cfg: Cfg, existing: Cfg[] = []) =>
  confirmServerLaunch(managerWith(existing), cfg, null);

beforeEach(() => {
  shown.length = 0;
  approve = true;
});

describe('confirmServerLaunch', () => {
  test('asks before launching a command it has not seen', async () => {
    const ok = await confirm(NEW_SERVER);

    expect(ok).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0].detail).toContain('C:/tools/thing.exe');
    expect(shown[0].detail).toContain('--serve');
  });

  test('declining blocks the launch', async () => {
    approve = false;

    expect(await confirm(NEW_SERVER)).toBe(false);
    expect(shown).toHaveLength(1);
  });

  test('asks again when the arguments change', async () => {
    const existing = { ...NEW_SERVER, args: ['--serve'] };
    await confirm({ ...NEW_SERVER, args: ['--serve', '--allow-write'] } as Cfg, [existing]);

    expect(shown).toHaveLength(1);
  });

  test('asks again, and says so, when a server is escalated to trusted', async () => {
    await confirm({ ...NEW_SERVER, trust: true } as Cfg, [NEW_SERVER]);

    expect(shown).toHaveLength(1);
    expect(shown[0].detail).toContain('WITHOUT asking');
  });

  test('does not ask when only the name or enabled flag changed', async () => {
    approve = false; // would block if it asked

    const ok = await confirm({ ...NEW_SERVER, name: 'Renamed', enabled: false } as Cfg, [NEW_SERVER]);

    expect(ok).toBe(true);
    expect(shown).toEqual([]);
  });

  test('does not ask when trust is being dropped', async () => {
    approve = false; // would block if it asked
    const trusted = { ...NEW_SERVER, trust: true } as Cfg;

    const ok = await confirm({ ...NEW_SERVER, trust: false } as Cfg, [trusted]);

    expect(ok).toBe(true);
    expect(shown).toEqual([]);
  });

  test('shows an HTTP endpoint without exposing its bearer token', async () => {
    const cfg = {
      id: 'obsidian', name: 'Obsidian', enabled: true, transport: 'http',
      url: 'https://127.0.0.1:27124/mcp/', bearerToken: 'do-not-display'
    } as Cfg;

    expect(await confirm(cfg)).toBe(true);
    expect(shown[0].detail).toContain('https://127.0.0.1:27124/mcp/');
    expect(shown[0].detail).not.toContain('do-not-display');
  });
});
