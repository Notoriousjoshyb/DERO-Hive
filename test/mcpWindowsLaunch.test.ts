import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const parse = require('cross-spawn/lib/parse') as (
  command: string,
  args: string[],
  options: Record<string, unknown>
) => { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };

describe.skipIf(process.platform !== 'win32')('Windows MCP command launch', () => {
  test('the SDK launcher routes command shims through ComSpec safely', () => {
    for (const command of ['npx', 'npm', 'pnpm', 'yarn', 'uvx', 'bunx']) {
      const launch = parse(command, ['-y', 'package name', 'A&B'], {});

      // uvx and bunx may be native .exe files; those correctly bypass cmd.
      if (launch.options.windowsVerbatimArguments) {
        expect(launch.command.toLowerCase()).toBe((process.env.ComSpec || 'cmd.exe').toLowerCase());
        expect(launch.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
        expect(launch.args[3]).toContain('package^ name');
        expect(launch.args[3]).toContain('A^&B');
      } else {
        expect(launch.command).toBe(command);
      }
    }
  });
});
