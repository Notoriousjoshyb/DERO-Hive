import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { LspServerConfig } from '@shared/types';
import { logger } from '../utils/logger';
import { encodeMessage, LspFramer, pathToUri, type LspMessage } from './codec';

/**
 * A minimal LSP client: enough to answer "where is this defined", "who calls
 * it", "what is it", "what is wrong with this file" and "what is in this
 * project".
 *
 * Deliberately not a full implementation. Hive is a consumer of language
 * intelligence, not an editor: there is no incremental sync, no formatting, no
 * code actions. Documents are opened whole and re-opened when they change on
 * disk, which is correct because Hive's own edits go through the filesystem.
 *
 * See REMAINING_WORK.md §3.8.
 */

const INITIALIZE_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** How long to wait for a server to publish diagnostics after a document opens. */
const DIAGNOSTICS_SETTLE_MS = 2_000;

export interface Diagnostic {
  line: number;
  character: number;
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source?: string;
}

export class LspSession {
  private child: ChildProcess | null = null;
  private framer = new LspFramer();
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** uri → latest diagnostics pushed by the server. */
  private diagnostics = new Map<string, Diagnostic[]>();
  /** uri → version + the content that version holds. */
  private opened = new Map<string, { version: number; text: string }>();
  private starting: Promise<void> | null = null;
  private stopped = false;

  constructor(readonly config: LspServerConfig, readonly rootPath: string) {}

  /** Start once; concurrent callers share the same handshake. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().catch((err) => {
      // A failed start must not be cached as success, or every later call
      // silently talks to a dead process.
      this.starting = null;
      throw err;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const child = spawn(this.config.command, this.config.args || [], {
      cwd: this.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const message of this.framer.push(chunk)) this.handle(message);
    });
    // Language servers log freely on stderr; keep it out of the user's face but
    // in the log, because it is the only clue when a server refuses to start.
    child.stderr?.on('data', (chunk: Buffer) => {
      logger.debug('lsp', `[${this.config.id}] ${chunk.toString('utf-8').trim()}`);
    });
    child.on('exit', (code) => {
      this.failAll(new Error(`Language server ${this.config.id} exited (code ${code ?? 'unknown'}).`));
      this.child = null;
      this.starting = null;
    });
    child.on('error', (err) => {
      this.failAll(new Error(`Language server ${this.config.id} could not start: ${err.message}`));
    });

    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToUri(this.rootPath),
      workspaceFolders: [{ uri: pathToUri(this.rootPath), name: 'workspace' }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: {}
        },
        workspace: { workspaceFolders: true, symbol: {} }
      }
    }, INITIALIZE_TIMEOUT_MS);

    this.notify('initialized', {});
  }

  /** Make sure the server has the file's current content. */
  async openDocument(path: string): Promise<string> {
    const uri = pathToUri(path);
    const text = await readFile(path, 'utf-8');
    const existing = this.opened.get(uri);
    if (existing && existing.text === text) return uri;

    if (existing) {
      // Full replacement, not an incremental edit: Hive changes files on disk,
      // so it never holds a reliable list of the edits since the last version.
      this.opened.set(uri, { version: existing.version + 1, text });
      this.notify('textDocument/didChange', {
        textDocument: { uri, version: existing.version + 1 },
        contentChanges: [{ text }]
      });
      return uri;
    }

    this.opened.set(uri, { version: 1, text });
    this.diagnostics.delete(uri);
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: languageIdFor(path), version: 1, text }
    });
    return uri;
  }

  /**
   * Diagnostics are *pushed*, not requested, so there is nothing to await. Wait
   * briefly for the first publish for this file; an empty result after the wait
   * means "nothing to report", which is also what a clean file looks like.
   */
  async diagnosticsFor(uri: string): Promise<Diagnostic[]> {
    const deadline = Date.now() + DIAGNOSTICS_SETTLE_MS;
    while (!this.diagnostics.has(uri) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.diagnostics.get(uri) || [];
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (!this.child || this.stopped) return Promise.reject(new Error(`Language server ${this.config.id} is not running.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async dispose(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      // Ask politely, briefly — a server that ignores shutdown still gets killed.
      await Promise.race([this.request('shutdown', null, 2_000), new Promise((r) => setTimeout(r, 2_000))]);
      this.notify('exit', null);
    } catch { /* it is going away regardless */ }
    this.child?.kill();
    this.child = null;
    this.failAll(new Error('Language server stopped.'));
  }

  private send(message: LspMessage): void {
    try {
      this.child?.stdin?.write(encodeMessage(message));
    } catch (err) {
      logger.warn('lsp', `write failed for ${this.config.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handle(message: LspMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id as number);
      if (!entry) return;
      this.pending.delete(message.id as number);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }

    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
      if (typeof params?.uri === 'string') {
        this.diagnostics.set(params.uri, normalizeDiagnostics(params.diagnostics));
      }
      return;
    }

    // A server request (e.g. workspace/configuration) that goes unanswered can
    // block its progress, so reply with a null result rather than ignoring it.
    if (message.id !== undefined && message.method) {
      this.send({ jsonrpc: '2.0', id: message.id, result: null });
    }
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}

const SEVERITY: Record<number, Diagnostic['severity']> = { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' };

function normalizeDiagnostics(raw: unknown): Diagnostic[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const item = (d ?? {}) as { range?: { start?: { line?: number; character?: number } }; severity?: number; message?: unknown; source?: unknown };
    return {
      // LSP counts from 0; everything user- and model-facing counts from 1.
      line: (item.range?.start?.line ?? 0) + 1,
      character: (item.range?.start?.character ?? 0) + 1,
      severity: SEVERITY[item.severity ?? 1] || 'error',
      message: String(item.message ?? '').trim(),
      source: typeof item.source === 'string' ? item.source : undefined
    };
  });
}

const LANGUAGE_IDS: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.rb': 'ruby', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown', '.sh': 'shellscript',
  '.bas': 'basic'
};

export function languageIdFor(path: string): string {
  return LANGUAGE_IDS[extname(path).toLowerCase()] || 'plaintext';
}
