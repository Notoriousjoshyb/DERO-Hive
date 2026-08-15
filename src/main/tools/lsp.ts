import { relative } from 'node:path';
import { uriToPath } from '../lsp/codec';
import { lspManager, LspUnavailableError, LSP_UNAVAILABLE } from '../lsp/manager';
import type { LspSession } from '../lsp/session';

/**
 * The `lsp` tool's actions, rendered for the model.
 *
 * Positions cross the boundary as 1-based line and column, because that is what
 * every editor, compiler error and human uses. LSP itself is 0-based, and the
 * conversion happens here so nothing outside this file has to remember which
 * convention it is holding.
 *
 * See REMAINING_WORK.md §3.8.
 */

export type LspAction = 'definition' | 'references' | 'hover' | 'diagnostics' | 'symbols';

export interface LspToolResult {
  content: string;
  isError?: boolean;
  meta?: Record<string, unknown>;
}

interface Location {
  path: string;
  line: number;
  character: number;
}

export async function runLsp(args: {
  action: LspAction;
  path: string;
  line?: number;
  character?: number;
  root: string;
}): Promise<LspToolResult> {
  let session: LspSession;
  try {
    session = await lspManager.sessionFor(args.path, args.root);
  } catch (err) {
    if (err instanceof LspUnavailableError) {
      // Structured, and the same shape whatever the provider situation is: the
      // model can branch on the code rather than reading the prose.
      return { content: `${LSP_UNAVAILABLE}: ${err.message}`, isError: true, meta: { code: LSP_UNAVAILABLE } };
    }
    throw err;
  }

  const uri = await session.openDocument(args.path);
  const position = { line: Math.max(0, (args.line ?? 1) - 1), character: Math.max(0, (args.character ?? 1) - 1) };

  if (args.action === 'diagnostics') {
    const diagnostics = await session.diagnosticsFor(uri);
    if (diagnostics.length === 0) return { content: 'No diagnostics.', meta: { diagnostics: [] } };
    return {
      content: diagnostics
        .map((d) => `${d.severity.toUpperCase()} ${args.path}:${d.line}:${d.character} ${d.message}${d.source ? ` [${d.source}]` : ''}`)
        .join('\n'),
      meta: { diagnostics }
    };
  }

  if (args.action === 'symbols') {
    const raw = await session.request('textDocument/documentSymbol', { textDocument: { uri } });
    const symbols = flattenSymbols(raw);
    if (symbols.length === 0) return { content: 'No symbols reported.', meta: { symbols: [] } };
    return {
      content: symbols.map((s) => `${'  '.repeat(s.depth)}${s.kind} ${s.name}  (line ${s.line})`).join('\n'),
      meta: { symbols }
    };
  }

  if (args.action === 'hover') {
    const raw = await session.request('textDocument/hover', { textDocument: { uri }, position });
    const text = hoverText(raw);
    return text
      ? { content: text, meta: { hover: text } }
      : { content: 'No hover information at that position.', meta: { hover: null } };
  }

  const method = args.action === 'definition' ? 'textDocument/definition' : 'textDocument/references';
  const params = args.action === 'references'
    ? { textDocument: { uri }, position, context: { includeDeclaration: false } }
    : { textDocument: { uri }, position };
  const raw = await session.request(method, params);
  const locations = normalizeLocations(raw);
  if (locations.length === 0) {
    return { content: `No ${args.action} found at ${args.path}:${args.line ?? 1}:${args.character ?? 1}.`, meta: { locations: [] } };
  }
  return {
    content: locations.map((l) => `${displayPath(l.path, args.root)}:${l.line}:${l.character}`).join('\n'),
    meta: { locations }
  };
}

function displayPath(path: string, root: string): string {
  const rel = relative(root, path);
  // A result outside the workspace (a dependency, a stdlib file) keeps its
  // absolute path — a '../../..' chain is worse than the truth.
  return rel && !rel.startsWith('..') ? rel : path;
}

/** `Location`, `Location[]` and `LocationLink[]` are all legal replies. */
export function normalizeLocations(raw: unknown): Location[] {
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Location[] = [];
  for (const item of items) {
    const o = (item ?? {}) as {
      uri?: string;
      range?: { start?: { line?: number; character?: number } };
      targetUri?: string;
      targetSelectionRange?: { start?: { line?: number; character?: number } };
      targetRange?: { start?: { line?: number; character?: number } };
    };
    const uri = o.uri ?? o.targetUri;
    if (typeof uri !== 'string') continue;
    const start = (o.range ?? o.targetSelectionRange ?? o.targetRange)?.start;
    out.push({
      path: uriToPath(uri),
      line: (start?.line ?? 0) + 1,
      character: (start?.character ?? 0) + 1
    });
  }
  return out;
}

export interface FlatSymbol {
  name: string;
  kind: string;
  line: number;
  depth: number;
}

const SYMBOL_KINDS: Record<number, string> = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method', 7: 'property',
  8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function', 13: 'variable',
  14: 'constant', 15: 'string', 16: 'number', 17: 'boolean', 18: 'array', 19: 'object',
  20: 'key', 21: 'null', 22: 'enum-member', 23: 'struct', 24: 'event', 25: 'operator', 26: 'type-parameter'
};

/** Flatten either reply shape: hierarchical DocumentSymbol or flat SymbolInformation. */
export function flattenSymbols(raw: unknown, depth = 0): FlatSymbol[] {
  if (!Array.isArray(raw)) return [];
  const out: FlatSymbol[] = [];
  for (const item of raw) {
    const s = (item ?? {}) as {
      name?: unknown;
      kind?: number;
      children?: unknown;
      range?: { start?: { line?: number } };
      selectionRange?: { start?: { line?: number } };
      location?: { range?: { start?: { line?: number } } };
    };
    if (typeof s.name !== 'string') continue;
    const line = (s.selectionRange?.start?.line ?? s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1;
    out.push({ name: s.name, kind: SYMBOL_KINDS[s.kind ?? 0] || 'symbol', line, depth });
    if (Array.isArray(s.children)) out.push(...flattenSymbols(s.children, depth + 1));
  }
  return out;
}

/** Hover contents come in three historical shapes; all of them reduce to text. */
export function hoverText(raw: unknown): string {
  const contents = (raw as { contents?: unknown } | null)?.contents;
  if (!contents) return '';
  const parts = Array.isArray(contents) ? contents : [contents];
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      const p = (part ?? {}) as { value?: unknown; language?: unknown };
      if (typeof p.value !== 'string') return '';
      return typeof p.language === 'string' && p.language ? `\`\`\`${p.language}\n${p.value}\n\`\`\`` : p.value;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
