import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'hive-search-'));
process.env.HIVE_DATA_DIR = root;
process.env.HIVE_CLI = '1';

async function main(): Promise<void> {
  const { formatResults, searchSecretKey, resolveSearchConfig, webSearchAvailable } = await import('./webSearch');

  // ── unavailable is the default, and it never throws ─────────────────────
  // There is no database in this environment, which is exactly the shape of
  // "not configured": the tool must be absent, not broken.
  assert.equal(resolveSearchConfig(), null);
  assert.equal(webSearchAvailable(), false);

  // ── secret naming is stable, because a rename silently loses the key ────
  assert.equal(searchSecretKey('brave'), 'websearch:brave');
  assert.equal(searchSecretKey('tavily'), 'websearch:tavily');

  // ── result rendering ───────────────────────────────────────────────────
  assert.match(formatResults('dero', []), /No results for "dero"/);
  const text = formatResults('dero', [
    { title: 'DERO Home', url: 'https://dero.io', snippet: 'Private   blockchain\nplatform' },
    { title: '', url: 'https://docs.dero.io', snippet: '' }
  ]);
  assert.match(text, /2 result\(s\) for "dero"/);
  assert.match(text, /1\. DERO Home/);
  assert.match(text, /https:\/\/dero\.io/);
  assert.ok(text.includes('Private blockchain platform'), 'snippets are collapsed to one line');
  assert.match(text, /2\. https:\/\/docs\.dero\.io/, 'a missing title falls back to the URL');

  // ── the tool is absent from the advertised list when unconfigured ───────
  const { listBuiltinTools } = await import('./builtin');
  const names = listBuiltinTools().map((t) => t.name);
  assert.ok(!names.includes('web_search'), 'no provider configured means no web_search tool');
  assert.ok(names.includes('web_fetch'), 'web_fetch needs no configuration and stays');
}

main()
  .then(() => { rmSync(root, { recursive: true, force: true }); console.log('webSearch.test.ts passed'); })
  .catch((err) => { rmSync(root, { recursive: true, force: true }); console.error(err); process.exit(1); });
