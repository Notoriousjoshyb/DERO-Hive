import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'hive-lsp-'));
process.env.HIVE_DATA_DIR = root;
process.env.HIVE_CLI = '1';

async function main(): Promise<void> {
  const { normalizeLocations, flattenSymbols, hoverText, runLsp } = await import('./lsp');
  const { LSP_UNAVAILABLE } = await import('../lsp/manager');

  // ── locations: three legal reply shapes, one result shape ───────────────
  {
    // A bare Location.
    assert.deepEqual(
      normalizeLocations({ uri: 'file:///p/a.ts', range: { start: { line: 4, character: 2 } } }),
      [{ path: process.platform === 'win32' ? '\\p\\a.ts' : '/p/a.ts', line: 5, character: 3 }],
      'LSP counts from 0; the tool reports from 1'
    );

    // An array of Locations.
    assert.equal(normalizeLocations([
      { uri: 'file:///p/a.ts', range: { start: { line: 0, character: 0 } } },
      { uri: 'file:///p/b.ts', range: { start: { line: 9, character: 4 } } }
    ]).length, 2);

    // LocationLink, which names its fields differently.
    const links = normalizeLocations([{
      targetUri: 'file:///p/c.ts',
      targetSelectionRange: { start: { line: 2, character: 6 } },
      targetRange: { start: { line: 1, character: 0 } }
    }]);
    assert.equal(links[0].line, 3, 'the selection range wins over the enclosing range');
    assert.equal(links[0].character, 7);

    // Nothing found, in each of its forms.
    assert.deepEqual(normalizeLocations(null), []);
    assert.deepEqual(normalizeLocations([]), []);
    assert.deepEqual(normalizeLocations([{ range: { start: { line: 1 } } }]), [], 'an entry with no uri is not a location');
  }

  // ── symbols: hierarchical and flat both flatten ────────────────────────
  {
    const hierarchical = flattenSymbols([{
      name: 'Widget', kind: 5, selectionRange: { start: { line: 3 } },
      children: [{ name: 'render', kind: 6, selectionRange: { start: { line: 8 } } }]
    }]);
    assert.deepEqual(hierarchical, [
      { name: 'Widget', kind: 'class', line: 4, depth: 0 },
      { name: 'render', kind: 'method', line: 9, depth: 1 }
    ]);

    const flat = flattenSymbols([{ name: 'helper', kind: 12, location: { range: { start: { line: 0 } } } }]);
    assert.deepEqual(flat, [{ name: 'helper', kind: 'function', line: 1, depth: 0 }]);

    assert.deepEqual(flattenSymbols(null), []);
    assert.deepEqual(flattenSymbols([{ kind: 5 }]), [], 'a nameless symbol is dropped, not rendered blank');
  }

  // ── hover: all three historical content shapes ─────────────────────────
  {
    assert.equal(hoverText({ contents: 'plain text' }), 'plain text');
    assert.equal(hoverText({ contents: { kind: 'markdown', value: '**bold**' } }), '**bold**');
    assert.equal(
      hoverText({ contents: [{ language: 'typescript', value: 'const x: number' }, 'and a note'] }),
      '```typescript\nconst x: number\n```\n\nand a note'
    );
    assert.equal(hoverText(null), '');
    assert.equal(hoverText({ contents: [] }), '');
  }

  // ── no server configured: structured, not a crash ──────────────────────
  {
    const result = await runLsp({ action: 'definition', path: join(root, 'nothing.ts'), line: 1, character: 1, root });
    assert.equal(result.isError, true);
    assert.equal(result.meta?.code, LSP_UNAVAILABLE, 'the model branches on the code, not the prose');
    assert.match(result.content, /^LSP_UNAVAILABLE: /);
    assert.match(result.content, /grep_files/, 'an unavailable tool must name the fallback');
  }

  // ── the schema does not change with availability ───────────────────────
  {
    const { listBuiltinTools } = await import('./builtin');
    const lsp = listBuiltinTools().find((t) => t.name === 'lsp');
    assert.ok(lsp, 'lsp is always advertised, unlike web_search — availability is per file, not per app');
    const actions = ((lsp.parameters as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum) || [];
    assert.deepEqual(actions, ['definition', 'references', 'hover', 'diagnostics', 'symbols']);
  }
}

main()
  .then(() => { rmSync(root, { recursive: true, force: true }); console.log('lsp.test.ts passed'); })
  .catch((err) => { rmSync(root, { recursive: true, force: true }); console.error(err); process.exit(1); });
