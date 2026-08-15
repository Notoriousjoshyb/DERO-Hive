import assert from 'node:assert/strict';
import { LspFramer, encodeMessage, pathToUri, uriToPath } from './codec';

// ── encode ───────────────────────────────────────────────────────────────
{
  const buf = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const text = buf.toString('utf-8');
  assert.ok(text.startsWith('Content-Length: '));
  assert.ok(text.includes('\r\n\r\n'));
  const declared = Number(text.match(/Content-Length: (\d+)/)![1]);
  const body = buf.subarray(buf.indexOf('\r\n\r\n') + 4);
  assert.equal(body.length, declared, 'the header must count bytes of the body');
}

// ── one message in one chunk ─────────────────────────────────────────────
{
  const framer = new LspFramer();
  const out = framer.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].result, { ok: true });
  assert.equal(framer.pending, 0);
}

// ── several messages in one chunk ────────────────────────────────────────
{
  const framer = new LspFramer();
  const joined = Buffer.concat([
    encodeMessage({ jsonrpc: '2.0', id: 1, result: 'a' }),
    encodeMessage({ jsonrpc: '2.0', id: 2, result: 'b' }),
    encodeMessage({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'c' } })
  ]);
  const out = framer.push(joined);
  assert.equal(out.length, 3);
  assert.equal(out[2].method, 'window/logMessage');
}

// ── one message split across chunks, byte by byte ────────────────────────
{
  const framer = new LspFramer();
  const whole = encodeMessage({ jsonrpc: '2.0', id: 7, result: { name: 'splitme' } });
  const received = [];
  for (const byte of whole) received.push(...framer.push(Buffer.from([byte])));
  assert.equal(received.length, 1, 'a message split to single bytes still arrives exactly once');
  assert.equal(received[0].id, 7);
}

// ── multi-byte characters split mid-character ────────────────────────────
{
  // This is the case that breaks string-based framing: 'é' is two bytes, and
  // the chunk boundary lands between them.
  const framer = new LspFramer();
  const whole = encodeMessage({ jsonrpc: '2.0', id: 9, result: { name: 'caf\u00e9 ☃ résumé' } });
  const mid = whole.length - 4;
  assert.deepEqual(framer.push(whole.subarray(0, mid)), [], 'an incomplete body yields nothing');
  assert.ok(framer.pending > 0);
  const out = framer.push(whole.subarray(mid));
  assert.equal(out.length, 1);
  assert.equal((out[0].result as { name: string }).name, 'café ☃ résumé', 'multi-byte content survives the split');
}

// ── junk recovery ────────────────────────────────────────────────────────
{
  const framer = new LspFramer();
  // A header with no Content-Length, then a real message: the real one must
  // still be delivered.
  const bad = Buffer.from('X-Nonsense: 1\r\n\r\n', 'ascii');
  const out = framer.push(Buffer.concat([bad, encodeMessage({ jsonrpc: '2.0', id: 3, result: 'after-junk' })]));
  assert.equal(out.length, 1);
  assert.equal(out[0].result, 'after-junk');

  // A body that is not JSON is skipped without desynchronizing the stream.
  const framer2 = new LspFramer();
  const notJson = Buffer.from('Content-Length: 3\r\n\r\n{{{', 'ascii');
  const out2 = framer2.push(Buffer.concat([notJson, encodeMessage({ jsonrpc: '2.0', id: 4, result: 'still-here' })]));
  assert.equal(out2.length, 1);
  assert.equal(out2[0].result, 'still-here');
}

// ── uri round trip ───────────────────────────────────────────────────────
{
  const cases = process.platform === 'win32'
    ? ['C:\\Users\\me\\project\\src\\a b.ts', 'C:\\proj\\café.ts']
    : ['/home/me/project/src/a b.ts', '/home/me/café.ts'];
  for (const path of cases) {
    const uri = pathToUri(path);
    assert.ok(uri.startsWith('file:///'), `${uri} must be a file URI`);
    assert.ok(!uri.includes(' '), 'spaces must be encoded');
    assert.equal(uriToPath(uri), path, `${path} must survive the round trip`);
  }
  assert.equal(uriToPath('untitled:Untitled-1'), 'untitled:Untitled-1', 'a non-file URI is returned unchanged');
}

console.log('codec.test.ts passed');
