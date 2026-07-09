import { useState } from 'react';
import type { ToolCall } from '@shared/types';

interface Props {
  toolCall: ToolCall;
  result?: string;
  isError?: boolean;
  durationMs?: number;
}

export function ToolCallCard({ toolCall, result, isError, durationMs }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  let args: unknown;
  try { args = JSON.parse(toolCall.function.arguments); } catch { args = toolCall.function.arguments; }

  const hasResult = result !== undefined;
  const status = hasResult ? (isError ? 'error' : 'success') : 'running';

  return (
    <div className={`text-xs rounded-lg border transition-colors ${
      expanded ? 'border-border bg-bg-elev/40' : 'border-transparent hover:border-border/70'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left py-1 px-2 rounded-lg hover:bg-bg-elev/50 transition-colors"
      >
        <StatusDot status={status} />
        <ToolIcon name={toolCall.function.name} />
        <span className={`font-medium ${status === 'error' ? 'text-danger' : 'text-fg'}`}>
          {toolCall.function.name}
        </span>
        {durationMs !== undefined && (
          <span className="text-fg-subtle/80 tabular-nums text-[10px]">{formatDuration(durationMs)}</span>
        )}
        <span className="text-fg-subtle truncate flex-1 font-mono text-[11px]">{summarizeArgs(toolCall.function.name, args)}</span>
        <svg className={`w-2.5 h-2.5 text-fg-subtle transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 8 8" fill="currentColor">
          <path d="M2 1l4 3-4 3z" />
        </svg>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pl-8 space-y-2 animate-fade-in">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-fg-subtle mb-1 font-medium">Arguments</div>
            <pre className="bg-bg-code border border-border/70 rounded-md px-2.5 py-1.5 text-fg-muted overflow-x-auto max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed">
              <code>{JSON.stringify(args, null, 2)}</code>
            </pre>
          </div>
          {hasResult && (
            <div>
              <div className={`text-[9px] uppercase tracking-wider mb-1 font-medium ${isError ? 'text-danger' : 'text-fg-subtle'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <pre className={`border rounded-md px-2.5 py-1.5 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${
                isError ? 'bg-danger/[0.06] border-danger/25 text-danger' : 'bg-bg-code border-border/70 text-fg-muted'
              }`}>
                <code>{(result || '').slice(0, 8000)}{(result || '').length > 8000 ? '…' : ''}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: 'running' | 'success' | 'error' }): JSX.Element {
  if (status === 'running') {
    return (
      <span className="relative flex w-2 h-2 flex-shrink-0" title="Running">
        <span className="absolute inline-flex h-full w-full rounded-full bg-warn opacity-60 animate-ping" />
        <span className="relative inline-flex rounded-full w-2 h-2 bg-warn" />
      </span>
    );
  }
  if (status === 'error') {
    return <span className="w-2 h-2 rounded-full bg-danger flex-shrink-0" title="Failed" />;
  }
  return <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" title="Succeeded" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolIcon({ name }: { name: string }): JSX.Element {
  if (name === 'run_shell' || name.endsWith('_shell') || name === 'bash') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-fg-subtle flex-shrink-0">
        <path d="M2 3l3 2-3 2M5 7h3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-fg-subtle flex-shrink-0">
        <path d="M2 1h5l1.5 1.5V9H2zM7 1v1.5h1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'grep_files' || name === 'search_files' || name === 'glob_files' || name === 'find_files') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-fg-subtle flex-shrink-0">
        <circle cx="4" cy="4" r="2.5" />
        <path d="M6 6l3 3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-fg-subtle flex-shrink-0">
      <circle cx="5" cy="5" r="4" />
    </svg>
  );
}

function summarizeArgs(name: string, args: unknown): string {
  if (typeof args !== 'object' || !args) return '';
  const a = args as Record<string, unknown>;
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') return String(a.path || '');
  if (name === 'list_directory') return String(a.path || '');
  if (name === 'glob_files' || name === 'find_files') return String(a.pattern || '');
  if (name === 'grep_files' || name === 'search_files') return `"${a.pattern || ''}"`;
  if (name === 'run_shell' || name === 'bash') return String(a.command || '').slice(0, 100);
  if (name === 'todo_write') return `${(a.todos as unknown[] | undefined)?.length || 0} items`;
  return JSON.stringify(args).slice(0, 100);
}
