import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC } from '@shared/types';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { resolveAndValidate, getWorkspaceRoot } from '../utils/pathPolicy';

const MAX_GLOB_RESULTS = 200;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'release', '.cache', '__pycache__', 'target', 'build', '.venv', 'venv']);
const TEXT_EXT = /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|tsx?|jsx?|vue|svelte|css|scss|less|html?|xml|svg|sql|sh|bash|zsh|ps1|bat|cmd|py|rb|go|rs|java|kt|swift|c|h|hpp|cc|cxx|cs|php|pl|lua|ex|exs|clj|cljs|cljc|edn|rkt|hs|dart|lock|env|gitignore|dockerignore|editorconfig|prettierrc|eslintrc|babelrc|log|csv|tsv|proto|toml|tf|hcl|nix|ipynb)$/i;

async function walk(root: string, pattern: string, results: { path: string; rel: string }[], depth: number): Promise<void> {
  if (depth > 6 || results.length >= MAX_GLOB_RESULTS) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  const re = patternToRegex(pattern);
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      await walk(full, pattern, results, depth + 1);
    } else if (e.isFile()) {
      const rel = relative(root, full).split(sep).join('/');
      if (re.test(rel) || rel.toLowerCase().includes(pattern.toLowerCase())) {
        results.push({ path: full, rel });
        if (results.length >= MAX_GLOB_RESULTS) return;
      }
    }
  }
}

function patternToRegex(pattern: string): RegExp {
  if (!pattern || pattern === '*') return /.*/;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try { return new RegExp(escaped, 'i'); } catch { return /.*/; }
}

export function registerFsHandlers(): void {
  ipcMain.handle(IPC.FS_READ, async (_e, { path, encoding, limit }: { path: string; encoding?: 'utf-8' | 'base64'; limit?: number }) => {
    const root = getWorkspaceRoot();
    const validated = resolveAndValidate(path, root);
    if (!existsSync(validated)) throw new Error(`File not found: ${path}`);
    if (encoding === 'base64') {
      const buf = await readFile(validated);
      return { content: buf.toString('base64'), encoding: 'base64', size: buf.length };
    }
    const text = await readFile(validated, 'utf-8');
    if (limit && text.length > limit) return { content: text.slice(0, limit) + '\n... [truncated]', truncated: true };
    return { content: text, encoding: 'utf-8', size: text.length };
  });

  ipcMain.handle(IPC.FS_WRITE, async (_e, { path, content }: { path: string; content: string }) => {
    const root = getWorkspaceRoot();
    const validated = resolveAndValidate(path, root);
    await mkdir(dirname(validated), { recursive: true });
    await writeFile(validated, content, 'utf-8');
    return { ok: true, size: content.length };
  });

  ipcMain.handle(IPC.FS_LIST, async (_e, path: string) => {
    const root = getWorkspaceRoot();
    const validated = resolveAndValidate(path, root);
    if (!existsSync(validated)) return [];
    const entries = await readdir(validated, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: join(validated, e.name),
      isDirectory: e.isDirectory(),
      isFile: e.isFile()
    }));
  });

  ipcMain.handle(IPC.FS_EXISTS, (_e, path: string) => {
    try {
      const validated = resolveAndValidate(path, getWorkspaceRoot());
      return existsSync(validated);
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.FS_MKDIR, async (_e, path: string) => {
    const validated = resolveAndValidate(path, getWorkspaceRoot());
    await mkdir(validated, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle(IPC.FS_PICK_DIRECTORY, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle(IPC.FS_PICK_FILE, async (e, filters) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: filters || undefined
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle(IPC.FS_GLOB, async (_e, { root, pattern, limit }: { root?: string; pattern: string; limit?: number }) => {
    const base = resolveAndValidate(root || getWorkspaceRoot(), getWorkspaceRoot());
    if (!existsSync(base)) return [];
    const results: { path: string; rel: string }[] = [];
    await walk(base, pattern, results, 0);
    return results.slice(0, limit ?? 50).map((r) => ({
      path: r.path,
      rel: r.rel,
      filename: basename(r.path),
      isText: TEXT_EXT.test(r.path)
    }));
  });
}