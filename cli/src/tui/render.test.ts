import React from 'react';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

const dataDir = mkdtempSync(join(tmpdir(), 'dero-hive-tui-'));
process.env.HIVE_DATA_DIR = dataDir;
process.env.HIVE_APP_ROOT = resolve('.');
process.env.HIVE_RESOURCES = resolve('resources');
process.env.HIVE_CLI = '1';
process.env.HIVE_TUI = '1';

const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream & {
  setRawMode: (enabled: boolean) => NodeJS.ReadStream;
  ref: () => NodeJS.ReadStream;
  unref: () => NodeJS.ReadStream;
};
Object.assign(stdout, { columns: 100, rows: 30, isTTY: true });
Object.assign(stdin, {
  isTTY: true,
  setRawMode() { return stdin; },
  ref() { return stdin; },
  unref() { return stdin; }
});
let output = '';
stdout.on('data', (chunk) => { output += chunk.toString(); });

const { initHive, shutdownHive } = await import('../utils/init.js');
const { App } = await import('./App.js');

try {
  await initHive();
  const instance = render(React.createElement(App, { options: { cwd: resolve('.') } }), {
    stdin,
    stdout,
    stderr: process.stderr,
    exitOnCtrlC: false,
    patchConsole: false
  });
  const exited = instance.waitUntilExit();
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  if (!/DERO HIVE/.test(output)) process.stderr.write(output);
  assert.match(output, /DERO HIVE/);
  const escape = String.fromCharCode(27);
  assert.ok(output.includes(`${escape}]10;#faf9f5`) || output.includes(`${escape}]10;#1f1e1c`));
  assert.ok(output.includes(`${escape}]11;#262624`) || output.includes(`${escape}]11;#faf9f5`));
  assert.match(output, /No provider is configured|no provider/i);
  for (const character of '/help') stdin.write(character);
  await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  stdin.write('\r');
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.match(output, /Commands/);
  stdin.write('\u001b');
  await new Promise((resolveWait) => setTimeout(resolveWait, 60));
  for (const character of '/attach README.md') stdin.write(character);
  await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  stdin.write('\r');
  await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  assert.match(output, /attachments.*README\.md/i);
  instance.unmount();
  await exited;
} finally {
  await shutdownHive();
  rmSync(dataDir, { recursive: true, force: true });
}
