import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC, type Attachment } from '@shared/types';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative, sep, extname } from 'node:path';
import { resolveWithinAllowed, getWorkspaceRoot } from '../utils/pathPolicy';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_READ_CHARS = 5_000_000;
const MAX_DIRECTORY_ENTRIES = 1_000;

const MIME_BY_EXT: Record<string, { mime: string; type: Attachment['type'] }> = {
  '.png': { mime: 'image/png', type: 'image' },
  '.jpg': { mime: 'image/jpeg', type: 'image' },
  '.jpeg': { mime: 'image/jpeg', type: 'image' },
  '.gif': { mime: 'image/gif', type: 'image' },
  '.webp': { mime: 'image/webp', type: 'image' },
  '.mp3': { mime: 'audio/mpeg', type: 'audio' },
  '.wav': { mime: 'audio/wav', type: 'audio' },
  '.m4a': { mime: 'audio/mp4', type: 'audio' },
  '.ogg': { mime: 'audio/ogg', type: 'audio' },
  '.pdf': { mime: 'application/pdf', type: 'pdf' }
};

const MAX_GLOB_RESULTS = 200;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'release', '.cache', '__pycache__', 'target', 'build', '.venv', 'venv']);
const TEXT_EXT = /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|tsx?|jsx?|vue|svelte|css|scss|less|html?|xml|svg|sql|sh|bash|zsh|ps1|bat|cmd|py|rb|go|rs|java|kt|swift|c|h|hpp|cc|cxx|cs|php|pl|lua|ex|exs|clj|cljs|cljc|edn|rkt|hs|dart|lock|env|gitignore|dockerignore|editorconfig|prettierrc|eslintrc|babelrc|log|csv|tsv|proto|toml|tf|hcl|nix|ipynb)$/i;

async function walk(base: string, dir: string, pattern: string, results: { path: string; rel: string }[], depth: number): Promise<void> {
  if (depth > 6 || results.length >= MAX_GLOB_RESULTS) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const re = patternToRegex(pattern);
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(base, full, pattern, results, depth + 1);
    } else if (e.isFile()) {
      // rel must be relative to the original base so nested paths match
      // patterns like "src/*.ts" and display correctly in autocomplete.
      const rel = relative(base, full).split(sep).join('/');
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
    const validated = resolveWithinAllowed(path);
    if (!existsSync(validated)) throw new Error(`File not found: ${path}`);
    if (encoding === 'base64') {
      const buf = await readFile(validated);
      return { content: buf.toString('base64'), encoding: 'base64', size: buf.length };
    }
    const text = await readFile(validated, 'utf-8');
    const maxChars = Math.min(limit || MAX_READ_CHARS, MAX_READ_CHARS);
    if (text.length > maxChars) return { content: text.slice(0, maxChars) + '\n... [truncated]', truncated: true, encoding: 'utf-8', size: text.length };
    return { content: text, encoding: 'utf-8', size: text.length };
  });

  ipcMain.handle(IPC.FS_WRITE, async (_e, { path, content }: { path: string; content: string }) => {
    const validated = resolveWithinAllowed(path);
    await mkdir(dirname(validated), { recursive: true });
    await writeFile(validated, content, 'utf-8');
    return { ok: true, size: content.length };
  });

  ipcMain.handle(IPC.FS_LIST, async (_e, path: string) => {
    const validated = resolveWithinAllowed(path);
    if (!existsSync(validated)) return [];
    const entries = await readdir(validated, { withFileTypes: true });
    return entries.slice(0, MAX_DIRECTORY_ENTRIES).map((e) => ({
      name: e.name,
      path: join(validated, e.name),
      isDirectory: e.isDirectory(),
      isFile: e.isFile()
    }));
  });

  ipcMain.handle(IPC.FS_EXISTS, (_e, path: string) => {
    try {
      const validated = resolveWithinAllowed(path);
      return existsSync(validated);
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.FS_MKDIR, async (_e, path: string) => {
    const validated = resolveWithinAllowed(path);
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

  ipcMain.handle(IPC.ATTACH_FROM_FILE, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'm4a', 'ogg', 'pdf', 'txt', 'md', 'json', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (r.canceled || r.filePaths.length === 0) return null;

    const out: Attachment[] = [];
    for (const filePath of r.filePaths) {
      const info = await stat(filePath);
      if (info.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`File too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB): ${basename(filePath)}`);
      }
      const buf = await readFile(filePath);
      const known = MIME_BY_EXT[extname(filePath).toLowerCase()];
      out.push({
        id: randomUUID(),
        type: known?.type ?? 'file',
        filename: basename(filePath),
        mimeType: known?.mime ?? 'application/octet-stream',
        size: buf.length,
        data: buf.toString('base64')
      });
    }
    return out;
  });

  ipcMain.handle(IPC.FS_GLOB, async (_e, { root, pattern, limit }: { root?: string; pattern: string; limit?: number }) => {
    const base = resolveWithinAllowed(root || getWorkspaceRoot());
    if (!existsSync(base)) return [];
    const results: { path: string; rel: string }[] = [];
    await walk(base, base, pattern, results, 0);
    return results.slice(0, limit ?? 50).map((r) => ({
      path: r.path,
      rel: r.rel,
      filename: basename(r.path),
      isText: TEXT_EXT.test(r.path)
    }));
  });
}
