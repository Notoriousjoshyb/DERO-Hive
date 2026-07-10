import type { ToolDefinition } from '@shared/types';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import { resolveAndValidate } from '../utils/pathPolicy';
import type { ToolExecutor, ToolContext } from './registry';

const execAsync = promisify(exec);

function safeResolve(p: string, cwd: string): string {
  return resolveAndValidate(p, cwd);
}

const READ_FILE_DEF: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns text, or base64 for binary files. Supports line ranges.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or working-directory-relative path' },
      start_line: { type: 'integer', description: '1-based start line (optional)' },
      end_line: { type: 'integer', description: '1-based end line (optional, inclusive)' },
      encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Default utf-8; use base64 for binaries' }
    },
    required: ['path']
  }
};

const WRITE_FILE_DEF: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file, creating parent directories as needed. Overwrites existing files.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  }
};

const EDIT_FILE_DEF: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace exact text in a file. old_text must match uniquely.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string', description: 'Exact text to replace' },
      new_text: { type: 'string' }
    },
    required: ['path', 'old_text', 'new_text']
  }
};

const LIST_DIR_DEF: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and subdirectories in a directory.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path']
  }
};

const GLOB_DEF: ToolDefinition = {
  name: 'glob_files',
  description: 'Find files matching a glob pattern. Example: "src/**/*.ts".',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      cwd: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' } }
    },
    required: ['pattern']
  }
};

const GREP_DEF: ToolDefinition = {
  name: 'grep_files',
  description: 'Search for a regex pattern across files. Returns file:line:content matches.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      cwd: { type: 'string' },
      include: { type: 'string', description: 'Glob filter, e.g. "*.ts"' },
      ignore: { type: 'array', items: { type: 'string' } },
      max_results: { type: 'integer', default: 100 }
    },
    required: ['pattern']
  }
};

const SHELL_DEF: ToolDefinition = {
  name: 'run_shell',
  description: 'Execute a shell command. Output is captured stdout+stderr. Use with care.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
      timeout_ms: { type: 'integer', default: 30_000 }
    },
    required: ['command']
  }
};

const TODO_DEF: ToolDefinition = {
  name: 'todo_write',
  description: 'Maintain a structured task list. Use for multi-step work to track progress.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { enum: ['pending', 'in_progress', 'completed'] },
            active_form: { type: 'string' }
          },
          required: ['content', 'status']
        }
      }
    },
    required: ['todos']
  }
};

export const BUILTIN_TOOLS: ToolDefinition[] = [
  READ_FILE_DEF, WRITE_FILE_DEF, EDIT_FILE_DEF,
  LIST_DIR_DEF, GLOB_DEF, GREP_DEF,
  SHELL_DEF, TODO_DEF
];

function diffStats(oldText: string, newText: string): { added: number; removed: number } {
  // Approximate diff: lines in new not in old (added) and lines in old not in new (removed).
  // Uses an LCS-free approach for speed; precision is good enough for session indicators.
  const oldLines = new Set(oldText.split('\n').map((l) => l.trim()).filter(Boolean));
  const newLines = new Set(newText.split('\n').map((l) => l.trim()).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const l of newLines) if (!oldLines.has(l)) added++;
  for (const l of oldLines) if (!newLines.has(l)) removed++;
  return { added, removed };
}

export const builtinExecutors: Record<string, ToolExecutor> = {
  async read_file(args, ctx: ToolContext) {
    const { path, start_line, end_line, encoding } = args as { path: string; start_line?: number; end_line?: number; encoding?: 'utf-8' | 'base64' };
    const abs = safeResolve(path, ctx.cwd);
    if (!existsSync(abs)) return { content: `Error: file not found: ${abs}`, isError: true };

    const enc = encoding || 'utf-8';
    if (enc === 'base64') {
      const buf = await readFile(abs);
      return { content: buf.toString('base64') };
    }
    const text = await readFile(abs, 'utf-8');
    const lines = text.split('\n');
    if (start_line || end_line) {
      const start = (start_line || 1) - 1;
      const end = end_line || lines.length;
      return { content: lines.slice(start, end).join('\n'), meta: { totalLines: lines.length, range: [start + 1, end] } };
    }
    if (lines.length > 2000) {
      return { content: lines.slice(0, 2000).join('\n') + `\n\n... [truncated, ${lines.length} total lines. Use start_line/end_line to read more.]` };
    }
    return { content: text };
  },

  async write_file(args, ctx) {
    const { path, content } = args as { path: string; content: string };
    const abs = safeResolve(path, ctx.cwd);
    let prevText = '';
    let isNewFile = true;
    try {
      prevText = await readFile(abs, 'utf-8');
      isNewFile = false;
    } catch { /* new file */ }
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf-8');
    const stats = diffStats(prevText, content);
    return {
      content: `Wrote ${content.length} bytes to ${abs}`,
      meta: {
        path: abs,
        kind: 'write',
        isNewFile,
        bytesAdded: content.length - prevText.length,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        finalLines: content.split('\n').length
      }
    };
  },

  async edit_file(args, ctx) {
    const { path, old_text, new_text } = args as { path: string; old_text: string; new_text: string };
    const abs = safeResolve(path, ctx.cwd);
    const text = await readFile(abs, 'utf-8');
    const occurrences = text.split(old_text).length - 1;
    if (occurrences === 0) return { content: `Error: old_text not found in ${abs}`, isError: true };
    if (occurrences > 1) return { content: `Error: old_text matches ${occurrences} locations; make it unique.`, isError: true };
    // Function replacement so `$&`/`$'` patterns in new_text are written literally
    const updated = text.replace(old_text, () => new_text);
    const stats = diffStats(old_text, new_text);
    await writeFile(abs, updated, 'utf-8');
    return {
      content: `Edited ${abs}`,
      meta: {
        path: abs,
        kind: 'edit',
        bytesAdded: new_text.length - old_text.length,
        linesAdded: stats.added,
        linesRemoved: stats.removed
      }
    };
  },

  async list_directory(args, ctx) {
    const { path } = args as { path: string };
    const abs = safeResolve(path, ctx.cwd);
    const entries = await readdir(abs, { withFileTypes: true });
    const out = entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore' || e.name === '.env.example')
      .map((e) => `${e.isDirectory() ? 'd' : 'f'}  ${e.name}`)
      .sort();
    return { content: out.join('\n') || '(empty)' };
  },

  async glob_files(args, ctx) {
    const { pattern, cwd, ignore } = args as { pattern: string; cwd?: string; ignore?: string[] };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;
    const matches = await fg(pattern, { cwd: base, ignore: ignore || ['**/node_modules/**', '**/.git/**', '**/dist/**'], dot: false });
    return { content: matches.slice(0, 500).join('\n') + (matches.length > 500 ? `\n... [${matches.length - 500} more]` : '') };
  },

  async grep_files(args, ctx) {
    const { pattern, cwd, include, ignore, max_results } = args as { pattern: string; cwd?: string; include?: string; ignore?: string[]; max_results?: number };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;
    const matches = await fg(include || '**/*', {
      cwd: base,
      ignore: ignore || ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      absolute: false
    });
    const re = new RegExp(pattern, 'gm');
    const out: string[] = [];
    const limit = max_results || 100;
    for (const file of matches) {
      const abs = join(base, file);
      let content: string;
      try { content = await readFile(abs, 'utf-8'); } catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (re.test(line)) {
          out.push(`${file}:${i + 1}:${line}`);
          if (out.length >= limit) break;
        }
        re.lastIndex = 0;
      }
      if (out.length >= limit) { out.push(`... [truncated at ${limit}]`); break; }
    }
    return { content: out.join('\n') || '(no matches)' };
  },

  async run_shell(args, ctx) {
    const { command, cwd, timeout_ms } = args as { command: string; cwd?: string; timeout_ms?: number };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;
    const timeout = timeout_ms || 30_000;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: base,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return { content: out.slice(0, 50_000) || '(no output)' };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return { content: `[exit ${(err as { code?: number }).code ?? 'err'}]\n${e.stdout || ''}${e.stderr ? '\n[stderr]\n' + e.stderr : ''}\n${e.message || ''}`, isError: true };
    }
  },

  async todo_write(args) {
    const { todos } = args as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; active_form?: string }> };
    const formatted = todos.map((t) => `[${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`).join('\n');
    return { content: formatted, meta: { todos } };
  }
};
