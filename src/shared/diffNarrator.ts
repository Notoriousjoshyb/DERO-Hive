import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface DiffNarratorResult {
  summary: string;       // one-paragraph plain English summary
  changedFiles: string[];  // list of changed files
  stats: { additions: number; deletions: number; files: number };
  narrated: string;       // multi-line readable diff narrative
}

/** Run `git diff --stat` and `git diff --name-only` to build a diff summary. */
export function narrateDiff(cwd: string, ref?: string): DiffNarratorResult | null {
  if (!existsSync(join(cwd, '.git'))) return null;
  try {
    const refArg = ref ? `${ref} HEAD` : 'HEAD~1 HEAD';
    const statRaw = execSync(`git diff --stat ${refArg}`, { cwd, encoding: 'utf-8', timeout: 10_000 });
    const namesRaw = execSync(`git diff --name-only ${refArg}`, { cwd, encoding: 'utf-8', timeout: 10_000 });

    const lines = statRaw.trim().split('\n');
    const lastStat = lines[lines.length - 1] || '';
    const files = namesRaw.trim().split('\n').filter(Boolean);
    const fileCount = files.length;

    // Parse additions/deletions from the last stat line
    // e.g. " src/main/ipc/chat.ts | 4 ++-- " → parse +4, -2
    const addMatch = lastStat.match(/(\d+) insertion/);
    const delMatch = lastStat.match(/(\d+) deletion/);
    const adds = addMatch ? parseInt(addMatch[1]) : 0;
    const dels = delMatch ? parseInt(delMatch[1]) : 0;

    // Categorise changed files
    const categories = categoriseFiles(files);
    const summary = buildSummary(categories, fileCount, adds, dels);

    const narrated = [
      `## Changes in this cycle`,
      ``,
      `**${fileCount} file${fileCount !== 1 ? 's' : ''} changed** — ${adds} addition${adds !== 1 ? 's' : ''}(+), ${dels} deletion${dels !== 1 ? 's' : ''}(-)`,
      ``,
      ...Object.entries(categories).map(([cat, files]) => `### ${cat}\n${files.map((f) => `- \`${f}\``).join('\n')}`),
    ].join('\n');

    return {
      summary,
      changedFiles: files,
      stats: { additions: adds, deletions: dels, files: fileCount },
      narrated,
    };
  } catch {
    return null;
  }
}

export function categoriseFiles(paths: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    'Backend (main process)': [],
    'Renderer / UI': [],
    'Shared types & utilities': [],
    'CLI': [],
    'Config & build': [],
    'Self-evolve': [],
    'Other': [],
  };

  for (const p of paths) {
    if (p.startsWith('src/main/')) categories['Backend (main process)'].push(p);
    else if (p.startsWith('src/renderer/')) categories['Renderer / UI'].push(p);
    else if (p.startsWith('src/shared/')) categories['Shared types & utilities'].push(p);
    else if (p.startsWith('cli/src/')) categories['CLI'].push(p);
    else if (p.startsWith('resources/') || p.startsWith('SELF_EVOLVE/')) categories['Self-evolve'].push(p);
    else if (p.match(/package\.json|tsconfig|webpack|vite|electron|rollup/)) categories['Config & build'].push(p);
    else categories['Other'].push(p);
  }

  // Remove empty categories
  return Object.fromEntries(Object.entries(categories).filter(([, v]) => v.length > 0));
}

export function buildSummary(cats: Record<string, string[]>, fileCount: number, adds: number, dels: number): string {
  const parts: string[] = [];
  const total = adds + dels;

  if (fileCount === 1) {
    const cat = Object.entries(cats)[0];
    parts.push(`1 file changed in ${cat[0].toLowerCase()}.`);
  } else {
    parts.push(`${fileCount} files changed across ${Object.keys(cats).length} area${Object.keys(cats).length !== 1 ? 's' : ''}.`);
  }

  if (cats['Backend (main process)']?.length) parts.push(`Backend work includes ${cats['Backend (main process)'].length} main-process file${cats['Backend (main process)'].length !== 1 ? 's' : ''}.`);
  if (cats['Renderer / UI']?.length) parts.push(`UI updates to ${cats['Renderer / UI'].length} renderer file${cats['Renderer / UI'].length !== 1 ? 's' : ''}.`);
  if (cats['Self-evolve']?.length) parts.push(`Self-evolve documentation updated.`);
  if (cats['Config & build']?.length) parts.push(`Build/config files touched.`);

  if (total > 0) parts.push(`Net ${adds > 0 ? '+' : ''}${adds} / ${dels > 0 ? '-' : ''}${dels} lines.`);
  return parts.join(' ');
}
