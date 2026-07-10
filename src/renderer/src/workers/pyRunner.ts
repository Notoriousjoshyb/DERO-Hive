import { loadPyodide, type PyodideInterface, version } from 'pyodide';
import type { RunMessage, SavedFile } from './types';

const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
const OUTPUT_DIR = '/tmp/code_runner_output';

let pyodide: PyodideInterface | null = null;
let isLoading = false;
let currentOutput = '';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendLine(line: string, prefix = ''): void {
  currentOutput += (currentOutput ? '\n' : '') + prefix + line;
}

async function ensurePyodide(): Promise<PyodideInterface> {
  if (pyodide) return pyodide;
  if (isLoading) {
    while (isLoading || !pyodide) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return pyodide!;
  }

  isLoading = true;
  try {
    pyodide = await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
      stdout: (line: string) => appendLine(line),
      stderr: (line: string) => appendLine(line, '[stderr] ')
    });
    (pyodide.FS as any).mkdirTree(OUTPUT_DIR);
  } finally {
    isLoading = false;
  }
  return pyodide;
}

function readSavedFiles(instance: PyodideInterface): SavedFile[] {
  try {
    const files: SavedFile[] = [];
    const names = (instance.FS as any).readdir(OUTPUT_DIR).filter((n: string) => n !== '.' && n !== '..' && n !== '.gitkeep');
    for (const name of names) {
      const path = `${OUTPUT_DIR}/${name}`;
      const stat = (instance.FS as any).stat(path);
      if (stat.mode & 0o40000) continue; // skip directories
      const bytes = (instance.FS as any).readFile(path) as Uint8Array;
      const content = new TextDecoder().decode(bytes);
      files.push({ name, content });
      (instance.FS as any).unlink(path);
    }
    return files;
  } catch {
    return [];
  }
}

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  const msg = event.data;
  if (msg.type !== 'run') return;

  try {
    const instance = await ensurePyodide();
    currentOutput = '';
    const wrapped = `
import os
os.makedirs('${OUTPUT_DIR}', exist_ok=True)
def save_file(name, content):
    with open(os.path.join('${OUTPUT_DIR}', name), 'w') as f:
        f.write(content)

${msg.code}
`;
    const result = instance.runPython(wrapped);
    const formatted = formatValue(result);
    const finalOutput = formatted ? `${currentOutput}${currentOutput ? '\n' : ''}${formatted}` : currentOutput;
    const savedFiles = readSavedFiles(instance);
    self.postMessage({ type: 'result', id: msg.id, output: finalOutput, savedFiles });
  } catch (err) {
    const savedFiles = pyodide ? readSavedFiles(pyodide) : [];
    self.postMessage({ type: 'result', id: msg.id, output: currentOutput, error: String(err), savedFiles });
  }
};
