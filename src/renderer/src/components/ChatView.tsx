import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { InputBar } from './InputBar';
import { MessageList } from './MessageList';
import { EmptyState } from './EmptyState';
import { TaskListPanel } from './TaskListPanel';
import { CompactionToast } from './CompactionToast';
import { extractThinking } from '../lib/thinking';
import { ThinkingDisclosure } from './Message';
import { SwarmActivity } from './SwarmActivity';
import type { HiveErrorInfo, HiveErrorKind } from '@shared/types';

export function ChatView(): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const streamingContent = useAppStore((s) => s.streamingContent);
  const streamingReasoning = useAppStore((s) => s.streamingReasoning);
  const chatError = useAppStore((s) => s.chatError);
  const setChatError = useAppStore((s) => s.setChatError);
  const currentId = useAppStore((s) => s.currentConversationId);
  const currentConv = useAppStore((s) => s.conversations.find((c) => c.id === s.currentConversationId));
  const providers = useAppStore((s) => s.providers);
  const [infoOpen, setInfoOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = false): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Track whether the user is pinned to the bottom
  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  // Auto-scroll only when the user hasn't scrolled away
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages.length, streamingContent, streamingReasoning, chatError, scrollToBottom]);

  // Always jump to bottom when switching conversations
  useEffect(() => {
    atBottomRef.current = true;
    setAtBottom(true);
    scrollToBottom();
  }, [currentId, scrollToBottom]);

  const hasMessages = messages.length > 0 || streamingContent.length > 0;

  const chatErrorInfo = useAppStore((s) => s.chatErrorInfo);
  const regenerateFrom = useAppStore((s) => s.regenerateFrom);
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id;
    }
    return undefined;
  }, [messages]);
  // auth/quota failures won't heal by resending — they need a settings change.
  const needsProviderFix = !!chatErrorInfo && !chatErrorInfo.retriable && (chatErrorInfo.kind === 'auth' || chatErrorInfo.kind === 'quota');
  const canRetry = !!chatErrorInfo && !needsProviderFix && !!lastUserMessageId;

  // Retry a failed turn: revert to the last user message and resend it
  // (regenerateFrom already handles the revert + skipUserPersist resend).
  const onRetry = useCallback((): void => {
    if (!lastUserMessageId) return;
    setChatError(null);
    void regenerateFrom(lastUserMessageId);
  }, [lastUserMessageId, regenerateFrom, setChatError]);

  return (
    <main className="flex-1 flex flex-col bg-bg min-w-0 relative">
      <CompactionToast />
      <FallbackToast />
      {currentConv && currentConv.providerId && (
        <div className="flex items-center justify-end px-4 pt-1.5">
          <button
            onClick={() => setInfoOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] text-fg-subtle hover:text-fg hover:bg-bg-elev rounded-md transition"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 6.5v3.5M7 4.5v.01" />
            </svg>
            {currentConv.providerId && (providers.find((p) => p.id === currentConv.providerId)?.name || currentConv.providerId)}
            {currentConv.model && ` / ${currentConv.model}`}
          </button>
          {infoOpen && (
            <div className="absolute top-10 right-4 z-50 w-64 p-3 bg-bg-elev border border-border rounded-xl shadow-elev-lg text-xs space-y-2 animate-fade-in"
              onClick={(e) => e.stopPropagation()}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Conversation Info</div>
              <div className="space-y-1.5">
                <InfoRow label="Title" value={currentConv.title} />
                <InfoRow label="Provider" value={providers.find((p) => p.id === currentConv.providerId)?.name || currentConv.providerId} />
                <InfoRow label="Model" value={currentConv.model || '(not set)'} />
                <InfoRow label="Messages" value={String(currentConv.messageCount || 0)} />
                <InfoRow label="Created" value={currentConv.createdAt ? new Date(currentConv.createdAt).toLocaleDateString() : '-'} />
                <InfoRow label="Tokens" value={currentConv.totalTokens ? Math.round(currentConv.totalTokens).toLocaleString() : 'N/A'} />
                <InfoRow label="ID" value={currentConv.id.slice(0, 12) + '…'} />
              </div>
              <button onClick={() => setInfoOpen(false)} className="w-full mt-1 px-2 py-1 rounded bg-bg-input text-fg-muted hover:text-fg text-[10px]">Close</button>
            </div>
          )}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {!hasMessages && !chatError ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto message-list-density h-full">
            {chatError && (
              <div className="bg-danger/[0.07] border border-danger/25 rounded-xl p-4 text-sm flex items-start gap-3 shadow-elev-sm animate-msg-in mb-5">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-danger/15 text-danger flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M8 5v4M8 11.5v.01" />
                    <path d="M7.13 2.5a1 1 0 011.74 0l5.5 9.5a1 1 0 01-.87 1.5H2.5a1 1 0 01-.87-1.5l5.5-9.5z" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium mb-0.5 text-fg">
                    {chatErrorInfo ? errorInfoLabel(chatErrorInfo) : "Couldn't get a response"}
                  </div>
                  <div className="text-fg-muted break-words text-[13px]">{chatErrorInfo?.message || chatError}</div>
                  {needsProviderFix && (
                    <div className="mt-1.5 text-[12px] text-fg-muted">
                      This needs a settings change, not a retry — check your API key and plan under{' '}
                      <button
                        onClick={() => useAppStore.setState({ settingsOpen: true, settingsInitialTab: 'providers' })}
                        className="text-accent hover:underline"
                      >
                        Settings → Providers
                      </button>
                      .
                    </div>
                  )}
                </div>
                {canRetry && (
                  <button
                    onClick={onRetry}
                    className="text-danger hover:text-white hover:bg-danger text-xs px-2 py-1 rounded-md border border-danger/30 transition flex-shrink-0"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={() => setChatError(null)}
                  className="text-fg-subtle hover:text-fg text-xs px-2 py-1 rounded-md hover:bg-bg-elev transition flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}
            <SwarmActivity conversationId={currentId} />
            <MessageList />
            {(streamingContent || streamingReasoning) && (
              <StreamingMessage content={streamingContent} reasoning={streamingReasoning} />
            )}
            <div className="h-4" />
          </div>
        )}
      </div>

      {!atBottom && hasMessages && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-36 left-1/2 -translate-x-1/2 z-30 w-8 h-8 rounded-full bg-bg-elev border border-border shadow-elev-md flex items-center justify-center text-fg-muted hover:text-fg hover:border-border-strong transition animate-fade-in"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 2.5v9M3 8l4 3.5L11 8" />
          </svg>
        </button>
      )}

      <div className="px-4">
        <div className="max-w-3xl mx-auto">
          <TaskListPanel />
        </div>
      </div>

      <InputBar conversationId={currentId} hasMessages={hasMessages} />
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-fg-muted font-mono text-[10px] truncate max-w-[140px]" title={value}>{value}</span>
    </div>
  );
}

function StreamingMessage({ content, reasoning }: { content: string; reasoning: string }): JSX.Element {
  const { content: cleanContent, thinking: inlineThinking } = useMemo(
    () => extractThinking(content || ''),
    [content]
  );
  const combinedReasoning = [reasoning, inlineThinking].filter(Boolean).join('\n\n').trim();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [content, reasoning]);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const thinkingLabel = combinedReasoning ? 'thinking' : 'responding';
  const elapsedText = elapsedSeconds >= 60
    ? `still ${thinkingLabel} for ${minutes}m ${seconds}s`
    : `${thinkingLabel}…`;

  return (
    <div className="pl-3 sm:pl-5 border-l-2 border-accent/30 animate-fade-in">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping" />
          <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-accent" />
        </span>
        <span className="font-medium text-fg-muted">Assistant</span>
        {!cleanContent && <span className="shimmer-text text-[11px]">{elapsedText}</span>}
      </div>
      {combinedReasoning && (
        <ThinkingDisclosure text={combinedReasoning} streaming={!cleanContent} />
      )}
      {cleanContent && <div className="prose-hive whitespace-pre-wrap">{cleanContent}</div>}
      <button
        onClick={() => void useAppStore.getState().abortChat()}
        className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-danger/30 bg-danger/10 text-[11px] text-danger hover:bg-danger hover:text-white transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="2" />
        </svg>
        Stop generating
      </button>
    </div>
  );
}


// ── Structured stream errors (Phase 1B) ─────────────────────────────

const ERROR_KIND_LABELS: Record<HiveErrorKind, string> = {
  rate_limit: 'rate limit',
  auth: 'authentication',
  quota: 'quota exceeded',
  overloaded: 'overloaded',
  network: 'network',
  invalid_request: 'invalid request',
  unknown: 'unknown'
};

function errorInfoLabel(info: HiveErrorInfo): string {
  const category = info.category === 'provider' ? 'Provider error'
    : info.category === 'tool' ? 'Tool error'
    : 'Harness error';
  return `${category} · ${ERROR_KIND_LABELS[info.kind] ?? info.kind}`;
}

// Transient notice when the provider fallback chain advances mid-turn
// (follows the CompactionToast pattern; sits below it so both can stack).
function FallbackToast(): JSX.Element | null {
  const lastFallback = useAppStore((s) => s.lastFallback);
  const dismissLastFallback = useAppStore((s) => s.dismissLastFallback);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastFallback) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [lastFallback]);

  if (!lastFallback || !visible) return null;

  const reason = lastFallback.reason.replace(/_/g, ' ');

  return (
    <div className="fixed top-28 right-4 z-50 w-80 bg-bg-elev/95 border border-border rounded-xl shadow-2xl backdrop-blur-sm animate-slide-down pointer-events-auto">
      <div className="flex items-start gap-2 p-3">
        <div className="flex-shrink-0 mt-0.5">
          <FallbackIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-fg">Provider failover</div>
          <div className="text-[11px] text-fg-muted mt-0.5">
            Switched to <span className="font-mono text-fg">{lastFallback.to.model}</span> ({lastFallback.to.providerId})
          </div>
          <div className="mt-1 text-[10px] text-warn font-mono">{reason}</div>
        </div>
        <button
          onClick={dismissLastFallback}
          className="flex-shrink-0 text-fg-subtle hover:text-fg text-sm leading-none px-1"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function FallbackIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5" className="text-warn" />
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" className="text-border" />
    </svg>
  );
}
