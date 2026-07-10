import type { RunMessage, ResultMessage } from './types';

const noop = (): never => {
  throw new Error('Network access is disabled in the sandboxed runner');
};

// Block network APIs inside the worker so JS snippets cannot phone home.
const g = self as any;
g.fetch = noop;
g.XMLHttpRequest = class XMLHttpRequestDisabled {
  constructor() {
    throw new Error('Network access is disabled in the sandboxed runner');
  }
};
g.WebSocket = class WebSocketDisabled {
  constructor() {
    throw new Error('Network access is disabled in the sandboxed runner');
  }
};
g.saveFile = (name: string, content: string, mimeType?: string): void => {
  savedFiles.push({ name, content, mimeType });
};

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console)
};

let currentOutput = '';
let consoleCallCount = 0;
const savedFiles: Array<{ name: string; content: string; mimeType?: string }> = [];
const MAX_CONSOLE_CALLS = 1000;
const MAX_OUTPUT_LENGTH = 50000;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
  if (typeof arg === 'symbol') return arg.toString();
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}

function makeConsoleMethod(level: 'log' | 'error' | 'warn' | 'info') {
  return (...args: unknown[]): void => {
    consoleCallCount++;
    if (consoleCallCount > MAX_CONSOLE_CALLS) {
      if (consoleCallCount === MAX_CONSOLE_CALLS + 1) {
        currentOutput += (currentOutput ? '\n' : '') + '[console output limit reached]';
      }
      return;
    }
    const line = args.map(formatArg).join(' ');
    currentOutput += (currentOutput ? '\n' : '') + line;
    if (currentOutput.length > MAX_OUTPUT_LENGTH) {
      currentOutput = currentOutput.slice(0, MAX_OUTPUT_LENGTH) + '\n[output truncated]';
    }
    originalConsole[level](...args);
  };
}

function restoreConsole(): void {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
}

self.onmessage = (event: MessageEvent<RunMessage>) => {
  const msg = event.data;
  if (msg.type !== 'run') return;

  currentOutput = '';
  consoleCallCount = 0;
  savedFiles.length = 0;
  console.log = makeConsoleMethod('log');
  console.error = makeConsoleMethod('error');
  console.warn = makeConsoleMethod('warn');
  console.info = makeConsoleMethod('info');

  const send = (payload: Omit<ResultMessage, 'type'>): void => {
    self.postMessage({ type: 'result', ...payload, savedFiles: savedFiles.slice() });
  };

  try {
    const fn = new Function(msg.code);
    const result = fn();
    Promise.resolve(result)
      .then((value) => {
        restoreConsole();
        if (value !== undefined) {
          currentOutput += (currentOutput ? '\n' : '') + formatArg(value);
        }
        send({ id: msg.id, output: currentOutput });
      })
      .catch((err) => {
        restoreConsole();
        send({ id: msg.id, output: currentOutput, error: String(err) });
      });
  } catch (err) {
    restoreConsole();
    send({ id: msg.id, output: currentOutput, error: String(err) });
  }
};
