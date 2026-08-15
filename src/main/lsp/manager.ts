import { extname } from 'node:path';
import type { LspServerConfig } from '@shared/types';
import { getSetting } from '../db/client';
import { logger } from '../utils/logger';
import { LspSession } from './session';

/**
 * The LSP provider seam.
 *
 * The model-visible schema never changes with what is installed: `lsp` is
 * always advertised with the same actions, and a workspace with no server
 * configured gets a structured `LSP_UNAVAILABLE` telling it what to do instead.
 * That is the opposite choice to web_search — and deliberately so. Search is
 * either there or not, while language intelligence is per-file: a project can
 * have a TypeScript server and no Python one, so a schema that appeared and
 * disappeared per file would be unusable.
 */

export const LSP_UNAVAILABLE = 'LSP_UNAVAILABLE';

export class LspUnavailableError extends Error {
  readonly code = LSP_UNAVAILABLE;
  constructor(message: string) {
    super(message);
    this.name = 'LspUnavailableError';
  }
}

export function configuredServers(): LspServerConfig[] {
  let raw: unknown;
  try {
    raw = (getSetting<{ lspServers?: unknown }>('appSettings') || {}).lspServers;
  } catch {
    return []; // no database yet
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const s = (item ?? {}) as Record<string, unknown>;
      return {
        id: String(s.id || s.command || 'server'),
        name: typeof s.name === 'string' ? s.name : undefined,
        command: String(s.command || ''),
        args: Array.isArray(s.args) ? s.args.map(String) : [],
        extensions: Array.isArray(s.extensions) ? s.extensions.map((e) => normalizeExt(String(e))) : [],
        enabled: s.enabled !== false
      } satisfies LspServerConfig;
    })
    .filter((s) => s.command && s.extensions.length > 0 && s.enabled);
}

function normalizeExt(ext: string): string {
  const e = ext.trim().toLowerCase();
  return e.startsWith('.') ? e : `.${e}`;
}

/** The server that handles this file, or null when none is configured for it. */
export function serverFor(path: string): LspServerConfig | null {
  const ext = extname(path).toLowerCase();
  return configuredServers().find((s) => s.extensions.includes(ext)) ?? null;
}

export class LspManager {
  private sessions = new Map<string, LspSession>();

  /**
   * Session for a file, started if needed. Sessions are keyed by server *and*
   * workspace root: one server process per project, shared by every file in it,
   * because that is what a language server's index is scoped to.
   */
  async sessionFor(path: string, rootPath: string): Promise<LspSession> {
    const config = serverFor(path);
    if (!config) {
      const configured = configuredServers();
      throw new LspUnavailableError(
        configured.length === 0
          ? 'No language server is configured. Add one in Settings → General → Language servers, or use grep_files and read_file instead.'
          : `No language server is configured for ${extname(path) || 'this file type'}. Configured: ${configured.map((c) => c.extensions.join('/')).join(', ')}. Use grep_files instead.`
      );
    }

    const key = `${config.id}\0${rootPath}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new LspSession(config, rootPath);
      this.sessions.set(key, session);
    }
    try {
      await session.start();
    } catch (err) {
      this.sessions.delete(key);
      throw new LspUnavailableError(
        `Language server "${config.id}" (${config.command}) could not start: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return session;
  }

  /** Stop every server. Called on app shutdown. */
  async disposeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(all.map((s) => s.dispose().catch((err) => {
      logger.warn('lsp', `dispose failed: ${err instanceof Error ? err.message : String(err)}`);
    })));
  }
}

/** Process-wide instance — the builtin tool and app shutdown share it. */
export const lspManager = new LspManager();
