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

export function ChatView(): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const streamingContent = useAppStore((s) => s.streamingContent);
  const streamingReasoning = useAppStore((s) => s.streamingReasoning);
  const chatError = useAppStore((s) => s.chatError);
  const setChatError = useAppStore((s) => s.setChatError);
  const currentId = useAppStore((s) => s.currentConversationId);
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

  return (
    <main className="flex-1 flex flex-col bg-bg min-w-0 relative">
      <CompactionToast />
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
                  <div className="font-medium mb-0.5 text-fg">Couldn't get a response</div>
                  <div className="text-fg-muted break-words text-[13px]">{chatError}</div>
                </div>
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
