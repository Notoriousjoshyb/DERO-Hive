import { useState, useCallback } from 'react';
import { runCode, normalizeLanguage } from '../lib/codeRunner';
import type { SavedFile } from '../workers/types';

interface CodeRunnerProps {
  language: string;
  code: string;
  onClose?: () => void;
}

export function CodeRunner({ language, code, onClose }: CodeRunnerProps): JSX.Element {
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);

  const clear = useCallback(() => {
    setOutput('');
    setError('');
    setTimedOut(false);
    setDurationMs(0);
    setSavedFiles([]);
  }, []);

  const handleRun = useCallback(async () => {
    clear();
    setRunning(true);
    const start = performance.now();
    try {
      const normalized = normalizeLanguage(language);
      if (!normalized) throw new Error(`Unsupported language: ${language}`);
      const result = await runCode(normalized, code);
      setOutput(result.output);
      setError(result.error || '');
      setTimedOut(!!result.timedOut);
      setSavedFiles(result.savedFiles || []);
      setDurationMs(Math.round(performance.now() - start));
    } catch (err) {
      setError(String(err));
      setDurationMs(Math.round(performance.now() - start));
    } finally {
      setRunning(false);
    }
  }, [language, code, clear]);

  return (
    <div className="border-t border-border terminal-surface">
      <div className="flex items-center justify-between px-3 py-1.5 terminal-chrome border-b border-[#333]">
        <div className="flex items-center gap-2">
          {running ? (
            <span className="relative flex w-2 h-2 flex-shrink-0" title="Running">
              <span className="absolute inline-flex h-full w-full rounded-full bg-warn opacity-60 animate-ping" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-warn" />
            </span>
          ) : (
            <TerminalIcon />
          )}
          <span className="text-[10px] text-[#ccc] font-mono">Output</span>
          {durationMs > 0 && (
            <span className="text-[10px] text-fg-subtle tabular-nums">{formatDuration(durationMs)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayIcon />
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev/10 transition"
          >
            <ClearIcon />
            Clear
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev/10 transition"
            >
              <CloseIcon />
              Close
            </button>
          )}
        </div>
      </div>
      <div className="p-3 font-mono text-xs leading-relaxed min-h-[2.5rem] max-h-64 overflow-auto text-[#d4d4d4]">
        {running && !output && !error && (
          <div className="flex items-center gap-2 text-fg-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
            Running…
          </div>
        )}
        {!running && !output && !error && (
          <span className="text-fg-subtle italic">Click Run to execute this code.</span>
        )}
        {error && <div className="term-err whitespace-pre-wrap">{error}</div>}
        {output && <div className="whitespace-pre-wrap">{output}</div>}
        {timedOut && !error && <div className="text-warn mt-1">Execution timed out.</div>}
        {savedFiles.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#333]">
            <div className="text-[10px] text-fg-subtle mb-1">Saved files</div>
            <div className="flex flex-wrap gap-2">
              {savedFiles.map((f) => (
                <button
                  key={f.name}
                  onClick={() => void openFile(f)}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-bg-elev hover:bg-accent/20 text-accent transition"
                >
                  <FileIcon />
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function openFile(file: SavedFile): Promise<void> {
  if (!file.content) return;
  const blob = new Blob([file.content], { type: file.mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

function TerminalIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-subtle"
    >
      <path d="M2 4l2 2-2 2M5 8h5" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-subtle"
    >
      <path d="M6 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4l-4-3z" />
      <path d="M6 1v3h4" />
    </svg>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <path d="M3 2l7 4-7 4z" />
    </svg>
  );
}

function ClearIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
