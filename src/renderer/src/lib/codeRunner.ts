import type { RunnerResult, SavedFile } from '../workers/types';

const JS_TIMEOUT_MS = 5000;
const PY_TIMEOUT_MS = 10000;
const OUTPUT_DIR = '.hive/code-runner-outputs';

const RUNNABLE_LANGUAGES: Record<string, 'javascript' | 'python' | undefined> = {
  js: 'javascript',
  javascript: 'javascript',
  python: 'python',
  py: 'python'
};

export function isRunnableLanguage(lang: string): boolean {
  return !!RUNNABLE_LANGUAGES[lang.toLowerCase()];
}

export function normalizeLanguage(lang: string): 'javascript' | 'python' | null {
  return RUNNABLE_LANGUAGES[lang.toLowerCase()] || null;
}

export async function runCode(
  language: 'javascript' | 'python',
  code: string,
  timeoutMs?: number
): Promise<RunnerResult> {
  if (language === 'javascript') {
    return runInJsWorker(code, timeoutMs ?? JS_TIMEOUT_MS);
  }
  return runInPyWorker(code, timeoutMs ?? PY_TIMEOUT_MS);
}

async function persistSavedFiles(savedFiles: SavedFile[] | undefined): Promise<SavedFile[]> {
  if (!savedFiles?.length) return [];
  const persisted: SavedFile[] = [];
  for (const file of savedFiles) {
    const path = `${OUTPUT_DIR}/${file.name}`;
    try {
      await window.hive.fsWrite(path, file.content);
      persisted.push({ ...file, path });
    } catch (err) {
      console.error('Failed to save code runner file', file.name, err);
    }
  }
  return persisted;
}

function runInJsWorker(code: string, timeoutMs: number): Promise<RunnerResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const worker = new Worker(new URL('../workers/jsRunner.ts', import.meta.url), { type: 'module' });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve({
        output: '',
        error: 'Execution timed out',
        timedOut: true,
        durationMs: Math.round(performance.now() - start)
      });
    }, timeoutMs);

    worker.onmessage = async (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      const data = e.data as { output?: string; error?: string; timedOut?: boolean; savedFiles?: SavedFile[] };
      const savedFiles = await persistSavedFiles(data.savedFiles);
      resolve({
        output: data.output || '',
        error: data.error,
        timedOut: data.timedOut,
        durationMs: Math.round(performance.now() - start),
        savedFiles
      });
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({
        output: '',
        error: err.message || 'Worker error',
        durationMs: Math.round(performance.now() - start)
      });
    };

    worker.postMessage({ type: 'run', id: crypto.randomUUID(), code, timeoutMs });
  });
}

let pyWorker: Worker | null = null;

function runInPyWorker(code: string, timeoutMs: number): Promise<RunnerResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    if (!pyWorker) {
      pyWorker = new Worker(new URL('../workers/pyRunner.ts', import.meta.url), { type: 'module' });
    }
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pyWorker?.terminate();
      pyWorker = null;
      resolve({
        output: '',
        error: 'Execution timed out',
        timedOut: true,
        durationMs: Math.round(performance.now() - start)
      });
    }, timeoutMs);

    const onMessage = async (e: MessageEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const data = e.data as { output?: string; error?: string; timedOut?: boolean; savedFiles?: SavedFile[] };
      const savedFiles = await persistSavedFiles(data.savedFiles);
      resolve({
        output: data.output || '',
        error: data.error,
        timedOut: data.timedOut,
        durationMs: Math.round(performance.now() - start),
        savedFiles
      });
    };

    const onError = (err: ErrorEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        output: '',
        error: err.message || 'Worker error',
        durationMs: Math.round(performance.now() - start)
      });
    };

    pyWorker.onmessage = onMessage;
    pyWorker.onerror = onError;
    pyWorker.postMessage({ type: 'run', id: crypto.randomUUID(), code, timeoutMs });
  });
}

export function terminatePyodideWorker(): void {
  pyWorker?.terminate();
  pyWorker = null;
}
