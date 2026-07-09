import { resolve, isAbsolute, relative } from 'node:path';
import { getSetting } from '../db/client';

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
