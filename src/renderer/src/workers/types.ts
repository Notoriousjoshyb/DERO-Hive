// Shared message types for the sandboxed inline code runners.

export interface RunMessage {
  type: 'run';
  id: string;
  code: string;
  timeoutMs: number;
}

export interface ResultMessage {
  type: 'result';
  id: string;
  output: string;
  error?: string;
  timedOut?: boolean;
  savedFiles?: SavedFile[];
}

export interface SavedFile {
  name: string;
  content: string;
  mimeType?: string;
  path?: string;
}

export interface RunnerResult {
  output: string;
  error?: string;
  timedOut?: boolean;
  durationMs: number;
  savedFiles?: SavedFile[];
}
