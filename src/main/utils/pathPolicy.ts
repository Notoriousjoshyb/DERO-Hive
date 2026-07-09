import { resolve, isAbsolute, relative } from 'node:path';
import { getSetting, getDb } from '../db/client';

export function getWorkspaceRoot(): string {
  try {
    return getSetting<string>('workingDirectory') || process.cwd();
  } catch {
    return process.cwd();
  }
}

export function isPathWithin(absPath: string, root: string): boolean {
  const rootAbs = resolve(root);
  const targetAbs = resolve(absPath);
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
  try {
    const rows = getDb().prepare('SELECT path FROM projects').all() as Array<{ path: string }>;
    for (const r of rows) {
      if (r.path && typeof r.path === 'string') roots.push(r.path);
    }
  } catch {
    // DB not ready — fall back to the workspace root only
  }
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
