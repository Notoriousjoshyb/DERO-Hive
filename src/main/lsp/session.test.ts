import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end against a fake language server: spawn, handshake, didOpen,
// requests, pushed diagnostics and shutdown, over the real stdio framing. No
// real server is installed on CI, and the framing is the part that breaks.
const dataDir = mkdtempSync(join(tmpdir(), 'hive-lsp-e2e-'));
process.env.HIVE_DATA_DIR = dataDir;
process.env.HIVE_CLI = '1';

const SERVER = join(dataDir, 'fake-server.cjs');
const SOURCE = join(dataDir, 'sample.ts');

// A minimal, deliberately awkward server: it answers in one shape per method,
// writes its replies in two chunks, and pushes diagnostics unprompted.
const FAKE_SERVER = `
let buffer = Buffer.alloc(0);
// Replies are queued: splitting a frame only tests the client fairly if the
// two halves stay adjacent. Interleaving two split replies would corrupt the
// stream on the server's side, which proves nothing about the client.
const outbox = [];
let flushing = false;
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf-8');
  outbox.push(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\\r\\n\\r\\n', 'ascii'), body]));
  flush();
}
function flush() {
  if (flushing || outbox.length === 0) return;
  flushing = true;
  const framed = outbox.shift();
  const cut = Math.max(1, framed.length - 3);
  process.stdout.write(framed.subarray(0, cut));
  setTimeout(() => {
    process.stdout.write(framed.subarray(cut));
    flushing = false;
    flush();
  }, 5);
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end === -1) return;
    const len = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString('ascii'))[1]);
    if (buffer.length < end + 4 + len) return;
    const msg = JSON.parse(buffer.subarray(end + 4, end + 4 + len).toString('utf-8'));
    buffer = buffer.subarray(end + 4 + len);
    handle(msg);
  }
});
function handle(msg) {
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
  if (msg.method === 'shutdown') return send({ jsonrpc: '2.0', id: msg.id, result: null });
  if (msg.method === 'exit') return process.exit(0);
  if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params.textDocument.uri;
    return send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [
      { range: { start: { line: 2, character: 4 } }, severity: 1, message: 'Cannot find name café', source: 'fake' }
    ] } });
  }
  if (msg.method === 'textDocument/definition') {
    return send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: msg.params.textDocument.uri, range: { start: { line: 0, character: 6 } } }] });
  }
  if (msg.method === 'textDocument/references') {
    return send({ jsonrpc: '2.0', id: msg.id, result: [] });
  }
  if (msg.method === 'textDocument/hover') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { contents: { kind: 'markdown', value: 'const answer: number' } } });
  }
  if (msg.method === 'textDocument/documentSymbol') {
    return send({ jsonrpc: '2.0', id: msg.id, result: [
      { name: 'answer', kind: 14, selectionRange: { start: { line: 0 } }, children: [] }
    ] });
  }
  if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
}
`;

async function main(): Promise<void> {
  writeFileSync(SERVER, FAKE_SERVER, 'utf-8');
  writeFileSync(SOURCE, 'const answer = 42;\nexport { answer };\n    café;\n', 'utf-8');

  const { initDb, closeDb, setSetting } = await import('../db/client');
  initDb();
  setSetting('appSettings', {
    lspServers: [{ id: 'fake', command: process.execPath, args: [SERVER], extensions: ['.ts'] }]
  });

  const { runLsp } = await import('../tools/lsp');
  const { lspManager, serverFor } = await import('./manager');

  // ── config resolution is by extension ──────────────────────────────────
  assert.equal(serverFor(SOURCE)?.id, 'fake');
  assert.equal(serverFor(join(dataDir, 'thing.py')), null, 'an unconfigured extension has no server');

  // ── definition ─────────────────────────────────────────────────────────
  const def = await runLsp({ action: 'definition', path: SOURCE, line: 2, character: 10, root: dataDir });
  assert.equal(def.isError, undefined);
  assert.match(def.content, /sample\.ts:1:7/, 'positions come back 1-based and workspace-relative');

  // ── hover ──────────────────────────────────────────────────────────────
  const hover = await runLsp({ action: 'hover', path: SOURCE, line: 1, character: 7, root: dataDir });
  assert.equal(hover.content, 'const answer: number');

  // ── diagnostics arrive pushed, not requested ──────────────────────────
  const diag = await runLsp({ action: 'diagnostics', path: SOURCE, root: dataDir });
  assert.match(diag.content, /ERROR/);
  assert.match(diag.content, /Cannot find name café/, 'multi-byte content survives the split frames');
  assert.match(diag.content, /:3:5/, 'diagnostic positions are 1-based too');

  // ── symbols ────────────────────────────────────────────────────────────
  const symbols = await runLsp({ action: 'symbols', path: SOURCE, root: dataDir });
  assert.match(symbols.content, /constant answer {2}\(line 1\)/);

  // ── an empty reply is "nothing found", not an error ────────────────────
  const refs = await runLsp({ action: 'references', path: SOURCE, line: 1, character: 7, root: dataDir });
  assert.equal(refs.isError, undefined);
  assert.match(refs.content, /No references found/);

  // ── the session is reused, not respawned per call ──────────────────────
  const again = await runLsp({ action: 'hover', path: SOURCE, line: 1, character: 7, root: dataDir });
  assert.equal(again.content, 'const answer: number');

  // ── an unconfigured file type is structured, not a crash ──────────────
  writeFileSync(join(dataDir, 'thing.py'), 'x = 1\n', 'utf-8');
  const unavailable = await runLsp({ action: 'hover', path: join(dataDir, 'thing.py'), line: 1, character: 1, root: dataDir });
  assert.equal(unavailable.meta?.code, 'LSP_UNAVAILABLE');
  assert.match(unavailable.content, /\.py|file type/);

  // ── a server that cannot start reports it, and is not cached as running ─
  setSetting('appSettings', {
    lspServers: [{ id: 'broken', command: join(dataDir, 'no-such-binary'), args: [], extensions: ['.md'] }]
  });
  writeFileSync(join(dataDir, 'readme.md'), '# hi\n', 'utf-8');
  const broken = await runLsp({ action: 'symbols', path: join(dataDir, 'readme.md'), root: dataDir });
  assert.equal(broken.meta?.code, 'LSP_UNAVAILABLE');
  assert.match(broken.content, /could not start/);

  await lspManager.disposeAll();
  closeDb();
}

/**
 * Windows holds a directory open for a moment after the process using it as a
 * cwd exits, so cleanup retries briefly and then gives up — a leftover temp
 * directory must never fail an otherwise passing test.
 */
async function cleanup(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(dataDir, { recursive: true, force: true }); return; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}

main()
  .then(async () => { await cleanup(); console.log('session.test.ts passed'); })
  .catch(async (err) => { await cleanup(); console.error(err); process.exit(1); });
