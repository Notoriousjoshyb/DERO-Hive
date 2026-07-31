import { resolve, isAbsolute, relative, dirname, basename, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { getSetting, getDb } from '../db/client';
import { getDefaultWorkspace } from './paths';
import type { AppSettings } from '@shared/types';

/**
 * Paths the user explicitly granted this session by picking them in an OS
 * file dialog (Open Folder / Open File). The dialog itself is the consent:
 * without this, a folder picked outside the workspace passes the dialog but
 * every subsequent fs IPC on it fails containment and the UI reads as broken.
 * Session-scoped on purpose — persistent grants go through settings/projects.
 */
const sessionRoots = new Set<string>();

export function grantSessionRoot(p: string): void {
  if (p && typeof p === 'string' && isAbsolute(p)) sessionRoots.add(resolve(p));
}

function getAppSettings(): Partial<AppSettings> {
  try {
    return getSetting<Partial<AppSettings>>('appSettings') || {};
  } catch {
    return {};
  }
}

/**
 * Resolve symlinks in `p`, keeping any trailing segments that do not exist yet.
 *
 * Plain `resolve()` is lexical, so a symlink inside the workspace pointing out
 * of it slips past a containment check and the file tools follow it. `realpath`
 * would catch that but throws on paths that have not been created — which is
 * every `write_file` to a new file — so canonicalise the deepest existing
 * ancestor and re-append the rest.
 */
export function canonicalizePath(p: string): string {
  const abs = resolve(p);
  let current = abs;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return abs; // hit the filesystem root; nothing to resolve
      missing.push(basename(current));
      current = parent;
    }
  }
}

export function getWorkspaceRoot(): string {
  try {
    // The renderer persists workingDirectory inside the appSettings blob;
    // the bare 'workingDirectory' key is kept as a legacy fallback.
    return getAppSettings().workingDirectory
      || getSetting<string>('workingDirectory')
      || getDefaultWorkspace();
  } catch {
    return getDefaultWorkspace();
  }
}

export function isPathWithin(absPath: string, root: string): boolean {
  // Compare canonical paths: a symlink out of the workspace must not be
  // mistaken for a path inside it.
  const rootAbs = canonicalizePath(root);
  const targetAbs = canonicalizePath(absPath);
  const rel = relative(rootAbs, targetAbs);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

export function resolveAndValidate(input: string, root: string): string {
  const abs = isAbsolute(input) ? resolve(input) : resolve(root, input);
  if (!isPathWithin(abs, root)) {
    throw new Error(`Path outside allowed workspace: ${input}`);
  }
  return abs;
}

/**
 * All roots the renderer may touch through fs/shell IPC: the global working
 * directory plus every configured project folder (projects can live anywhere
 * on disk, not just under the working directory).
 */
export function getAllowedRoots(): string[] {
  const roots = [getWorkspaceRoot()];
  // The Code tab's persisted "Open Folder" choice survives restarts, so it
  // must be a durable allowed root, not just a session grant.
  const codeFolder = getAppSettings().codeFolder;
  if (codeFolder && typeof codeFolder === 'string') roots.push(codeFolder);
  try {
    const rows = getDb().prepare('SELECT path FROM projects').all() as Array<{ path: string }>;
    for (const r of rows) {
      if (r.path && typeof r.path === 'string') roots.push(r.path);
    }
  } catch {
    // DB not ready — fall back to the workspace root only
  }
  roots.push(...sessionRoots);
  return roots;
}

/** Resolve `input` and require it to be inside at least one allowed root. */
export function resolveWithinAllowed(input: string): string {
  const abs = isAbsolute(input) ? resolve(input) : resolve(getWorkspaceRoot(), input);
  for (const root of getAllowedRoots()) {
    if (isPathWithin(abs, root)) return abs;
  }
  throw new Error(`Path outside allowed workspace: ${input}`);
}
