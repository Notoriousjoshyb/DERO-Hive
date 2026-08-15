import assert from 'node:assert/strict';
import { isBlockedAddress, assertFetchable, htmlToMarkdown } from './webFetch';

// ── SSRF guard: address classification ───────────────────────────────────
{
  for (const blocked of [
    '127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1'
  ]) {
    assert.equal(isBlockedAddress(blocked), true, `${blocked} must be blocked`);
  }
  for (const allowed of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isBlockedAddress(allowed), false, `${allowed} must be allowed`);
  }
}

// ── scheme and hostname checks ───────────────────────────────────────────
async function main(): Promise<void> {
  await assert.rejects(() => assertFetchable('file:///etc/passwd'), /Only http and https/);
  await assert.rejects(() => assertFetchable('ftp://example.com/x'), /Only http and https/);
  await assert.rejects(() => assertFetchable('not a url'), /Not a valid URL/);
  await assert.rejects(() => assertFetchable('http://localhost:8080/'), /loopback/);
  await assert.rejects(() => assertFetchable('http://127.0.0.1/'), /private or loopback/);
  await assert.rejects(() => assertFetchable('http://[::1]/'), /private or loopback/);
  await assert.rejects(() => assertFetchable('http://169.254.169.254/latest/meta-data/'), /private or loopback/);

  // ── html to markdown ───────────────────────────────────────────────────
  const html = `
    <html><head><title>T</title><style>body{color:red}</style></head>
    <body>
      <script>alert('no')</script>
      <h2>Heading</h2>
      <p>Some <strong>bold</strong> text &amp; an <a href="https://example.com">link</a>.</p>
      <ul><li>one</li><li>two</li></ul>
      <pre>code &lt;here&gt;</pre>
    </body></html>`;
  const md = htmlToMarkdown(html);
  assert.ok(!md.includes('alert('), 'scripts must not survive');
  assert.ok(!md.includes('color:red'), 'styles must not survive');
  assert.match(md, /## Heading/);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(md, /- one/);
  assert.match(md, /- two/);
  assert.match(md, /```\ncode <here>\n```/);
  assert.ok(!md.includes('&amp;'), 'entities must be decoded');

  // Entities and numeric references.
  assert.equal(htmlToMarkdown('<p>a &lt; b &#38; c &#x41;</p>'), 'a < b & c A');
  // Tag soup with no closing tags still yields text rather than throwing.
  assert.equal(htmlToMarkdown('<p>loose'), 'loose');
}

main()
  .then(() => console.log('webFetch.test.ts passed'))
  .catch((err) => { console.error(err); process.exit(1); });
