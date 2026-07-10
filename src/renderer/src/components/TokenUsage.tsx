import { useMemo, useCallback } from 'react';
import { useAppStore } from '../stores/app';
import {
  formatTokenCount,
  pressureColor,
  estimateAttachmentsTokens,
  breakdownByRole,
  calculatePressure,
  latestContextTokens,
  totalCompletionTokens
} from '../lib/tokenManager';

interface SessionTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  hasPricing: boolean;
}

function formatCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.0001) return '<$0.0001';
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function TokenUsageBar(): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const settings = useAppStore((s) => s.settings);
  const compactionHistory = useAppStore((s) => s.compactionHistory);
  const fileChanges = useAppStore((s) => s.fileChanges);

  const totals: SessionTotals = useMemo(() => {
    // Sum completion tokens across turns (each turn's completion is independent).
    // For prompt we use the latest prompt_tokens which represents the CURRENT context size,
    // not the cumulative sum (which would double-count).
    const lastPrompt = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'assistant' && m.usage?.promptTokens) return m.usage.promptTokens;
      }
      return 0;
    })();
    const completionTokens = totalCompletionTokens(messages);

    let inputPrice: number | undefined;
    let outputPrice: number | undefined;
    const provider = providers.find((p) => p.id === selectedProviderId);
    const model = provider?.models.find((m) => m.id === selectedModel);
    if (model) {
      inputPrice = model.inputPrice;
      outputPrice = model.outputPrice;
    }

    // Input cost is the cost of the LATEST prompt (that's what we'd be charged for on the next turn).
    const inputCost = inputPrice !== undefined ? (lastPrompt / 1_000_000) * inputPrice : 0;
    const outputCost = outputPrice !== undefined ? (completionTokens / 1_000_000) * outputPrice : 0;
    return {
      promptTokens: lastPrompt,
      completionTokens,
      totalTokens: lastPrompt + completionTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      hasPricing: inputPrice !== undefined || outputPrice !== undefined
    };
  }, [messages, providers, selectedProviderId, selectedModel]);

  // Aggregate file changes for current session (GitHub commit-style +/-).
  // NOTE: all hooks must run before the visibility early-return below, or
  // toggling showTokenUsage changes the hook count and crashes React.
  const fileSummary = useMemo(() => {
    const filesTouched = new Set<string>();
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const c of fileChanges) {
      filesTouched.add(c.path);
      totalAdded += c.linesAdded;
      totalRemoved += c.linesRemoved;
    }
    return { filesTouched, totalAdded, totalRemoved };
  }, [fileChanges]);

  if (!settings.showTokenUsage) return <></>;

  // Aggregate compaction telemetry for current session/conversation
  const sessionSavedTokens = compactionHistory.reduce((sum, e) => sum + e.tokensSaved, 0);
  const sessionCompactions = compactionHistory.length;

  return (
    <div className="flex items-center gap-3 text-[10px] text-fg-subtle font-mono">
      <span title={`Prompt: ${totals.promptTokens.toLocaleString()} · Completion: ${totals.completionTokens.toLocaleString()}`}>
        {formatTokenCount(totals.totalTokens)} tokens
      </span>
      <span className="text-fg-subtle/50">·</span>
      <span title={totals.hasPricing ? `Input: ${formatCost(totals.inputCost)} · Output: ${formatCost(totals.outputCost)}` : 'No pricing info for this model'}>
        {totals.hasPricing ? formatCost(totals.totalCost) : '—'}
      </span>
      {fileChanges.length > 0 && (
        <>
          <span className="text-fg-subtle/50">·</span>
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            title={`${fileSummary.filesTouched.size} file${fileSummary.filesTouched.size === 1 ? '' : 's'} changed: +${fileSummary.totalAdded} / -${fileSummary.totalRemoved} lines`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-fg-subtle">
              <path d="M3 1h4l2 2v6H1V1h2zM7 1v2h2" strokeLinejoin="round" />
            </svg>
            <span className="text-success">+{fileSummary.totalAdded}</span>
            <span className="text-fg-subtle/50">/</span>
            <span className="text-danger">−{fileSummary.totalRemoved}</span>
            <span className="text-fg-subtle/70">({fileSummary.filesTouched.size} file{fileSummary.filesTouched.size === 1 ? '' : 's'})</span>
          </span>
        </>
      )}
      {sessionCompactions > 0 && (
        <>
          <span className="text-fg-subtle/50">·</span>
          <span
            className="text-success/80"
            title={`Auto-compacted ${sessionCompactions}× this session, saved ${formatTokenCount(sessionSavedTokens)} tokens`}
          >
            ↻ {sessionCompactions}× saved {formatTokenCount(sessionSavedTokens)}
          </span>
        </>
      )}
    </div>
  );
}

export function ContextIndicator({ promptChars = 0 }: { promptChars?: number }): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const pendingAttachments = useAppStore((s) => s.pendingAttachments);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const compactConversation = useAppStore((s) => s.compactConversation);

  const model = useMemo(() => {
    const provider = providers.find((p) => p.id === selectedProviderId);
    return provider?.models.find((m) => m.id === selectedModel) || null;
  }, [providers, selectedProviderId, selectedModel]);

  const info = useMemo(() => {
    const breakdown = breakdownByRole(messages);
    const promptTokens = Math.ceil(promptChars / 4);
    const attachTokens = estimateAttachmentsTokens(pendingAttachments);
    // Use the latest reported context size from the model when available
    // (avoids double-counting assistant prompt tokens across turns).
    const latestUsed = latestContextTokens(messages);
    const estimatedUsed = breakdown.total + promptTokens + attachTokens;
    const used = latestUsed > 0 ? latestUsed : estimatedUsed;
    return {
      pressure: calculatePressure(used, model)
    };
  }, [messages, promptChars, pendingAttachments, model]);

  const onCompact = useCallback(async () => {
    await compactConversation();
  }, [compactConversation]);

  const usedPercent = info.pressure.percent;
  const showCompact = usedPercent >= 70 && !isStreaming && messages.length > 4;

  const barColor =
    info.pressure.level === 'over' || info.pressure.level === 'critical' ? 'bg-danger'
    : info.pressure.level === 'high' || info.pressure.level === 'warn' ? 'bg-warn'
    : 'bg-accent';

  return (
    <div className="flex items-center gap-2 text-[10px] text-fg-subtle font-mono">
      <span className={`${pressureColor(info.pressure.level)} font-medium`}>Context</span>
      <span>{formatTokenCount(info.pressure.used)}{info.pressure.limit ? ` / ${formatTokenCount(info.pressure.limit)}` : ''}</span>
      {info.pressure.limit && (
        <div className="w-20 h-1 bg-bg-elev rounded-full overflow-hidden flex-shrink-0">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.min(100, usedPercent)}%` }}
          />
        </div>
      )}
      {info.pressure.limit && (
        <span className={`w-7 text-right tabular-nums ${pressureColor(info.pressure.level)}`}>
          {usedPercent}%
        </span>
      )}
      {showCompact && (
        <button
          onClick={onCompact}
          className="ml-1 px-1.5 py-0.5 rounded bg-bg-elev hover:bg-accent hover:text-white border border-border text-fg-muted transition text-[10px]"
          title="Summarize older messages to free up context space"
        >
          Compact
        </button>
      )}
    </div>
  );
}

// Detailed context breakdown panel — could be expanded in a popover.
export function ContextBreakdown(): JSX.Element | null {
  const messages = useAppStore((s) => s.currentMessages);
  const pendingAttachments = useAppStore((s) => s.pendingAttachments);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);

  const data = useMemo(() => {
    const provider = providers.find((p) => p.id === selectedProviderId);
    const model = provider?.models.find((m) => m.id === selectedModel) || null;
    const breakdown = breakdownByRole(messages);
    const attachTokens = estimateAttachmentsTokens(pendingAttachments);
    return { breakdown, attachTokens, model };
  }, [messages, pendingAttachments, providers, selectedProviderId, selectedModel]);

  const total = data.breakdown.total + data.attachTokens;
  const items = [
    { label: 'System', value: data.breakdown.system, color: 'bg-fg-subtle' },
    { label: 'User', value: data.breakdown.user, color: 'bg-accent' },
    { label: 'Assistant', value: data.breakdown.assistant, color: 'bg-success' },
    { label: 'Reasoning', value: data.breakdown.reasoning, color: 'bg-warn' },
    { label: 'Tools', value: data.breakdown.tool, color: 'bg-info' },
    { label: 'Attachments', value: data.attachTokens, color: 'bg-accent/60' }
  ];

  if (total === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-bg-elev">
        {items.map((it) => total > 0 && it.value > 0 ? (
          <div
            key={it.label}
            className={`${it.color} transition-all`}
            style={{ width: `${(it.value / total) * 100}%` }}
            title={`${it.label}: ${formatTokenCount(it.value)}`}
          />
        ) : null)}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {items.filter((it) => it.value > 0).map((it) => (
          <div key={it.label} className="flex items-center gap-1 text-[10px] text-fg-subtle">
            <span className={`w-1.5 h-1.5 rounded-full ${it.color} flex-shrink-0`} />
            <span className="flex-1">{it.label}</span>
            <span className="tabular-nums">{formatTokenCount(it.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Re-export for backwards compat
// (intentionally empty — useCallback imported from react above)
