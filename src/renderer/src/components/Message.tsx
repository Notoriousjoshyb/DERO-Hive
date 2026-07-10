import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { Message as Msg, ToolDefinition } from '@shared/types';
import { useAppStore } from '../stores/app';
import { ToolCallCard } from './ToolCallCard';
import { MermaidBlock } from './MermaidBlock';
import { extractArtifacts } from '../lib/artifacts';
import { extractThinking } from '../lib/thinking';

interface Props {
  message: Msg;
  isLast?: boolean;
  toolDefs: ToolDefinition[];
}

export function Message({ message }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const pendingToolResults = useAppStore((s) => s.pendingToolResults);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const forkConversation = useAppStore((s) => s.forkConversation);
  const revertConversation = useAppStore((s) => s.revertConversation);
  const [msgCopied, setMsgCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(!!message.bookmarked);

  // Keep local star state in sync when the conversation reloads from DB.
  useEffect(() => {
    setBookmarked(!!message.bookmarked);
  }, [message.bookmarked]);

  // Strip <think>...</think> tags from content and merge into reasoning
  const { cleanContent, combinedReasoning } = useMemo(() => {
    if (typeof message.content !== 'string') {
      return { cleanContent: message.content, combinedReasoning: message.reasoning };
    }
    const { content, thinking } = extractThinking(message.content);
    const combined = [message.reasoning, thinking].filter(Boolean).join('\n\n').trim();
    return { cleanContent: content, combinedReasoning: combined || undefined };
  }, [message.content, message.reasoning]);

  // Extract and save Vision artifacts (idempotent), then tell the panel to
  // refresh. Auto-open only right after a response finished streaming — not
  // when re-rendering an old conversation.
  useEffect(() => {
    if (message.role === 'assistant' && typeof message.content === 'string' && currentConversationId) {
      const artifacts = extractArtifacts(message.content);
      if (artifacts.length === 0) return;
      void Promise.all(artifacts.map((a) => window.hive.artifactSave({
        conversationId: currentConversationId,
        messageId: message.id,
        ...a
      }))).then(() => {
        const st = useAppStore.getState();
        st.notifyArtifactsChanged();
        if (!st.visionOpen && Date.now() - st.lastStreamFinishedAt < 4000) {
          st.setVisionOpen(true);
        }
      });
    }
  }, [message.id, message.role, currentConversationId]);

  const copyMessage = async (): Promise<void> => {
    let text: string;
    if (message.role === 'assistant' && typeof cleanContent === 'string') {
      text = cleanContent;
    } else {
      text = messageContentToText(message.content);
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const forkFromHere = async (): Promise<void> => {
    if (!currentConversationId) return;
    await forkConversation(currentConversationId, message.id);
  };

  const toggleBookmark = async (): Promise<void> => {
    const next = !bookmarked;
    setBookmarked(next); // optimistic — the DB write follows
    try {
      await window.hive.msgBookmark(message.id, next);
      useAppStore.getState().notifyBookmarksChanged();
    } catch {
      setBookmarked(!next);
    }
  };

  const revertToHere = async (): Promise<void> => {
    if (!currentConversationId) return;
    if (!window.confirm('Revert this conversation to this message? Messages after this point will be deleted.')) return;
    await revertConversation(message.id);
  };

  if (message.role === 'user') {
    return (
      <div data-message-id={message.id} className="group flex flex-col items-end animate-msg-in">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bg-bubble border border-border/60 px-4 py-2.5 shadow-elev-sm select-text message-content">
          <UserContent content={message.content} />
        </div>
        {currentConversationId && (
          <MessageActions
            copied={msgCopied}
            bookmarked={bookmarked}
            onCopy={() => void copyMessage()}
            onFork={() => void forkFromHere()}
            onRevert={() => void revertToHere()}
            onBookmark={() => void toggleBookmark()}
          />
        )}
      </div>
    );
  }

  // Tool result messages are folded into the matching ToolCallCard;
  // skip them here to avoid duplicate display.
  if (message.role === 'tool') {
    return <></>;
  }

  // Assistant — flowing inline layout
  return (
    <div data-message-id={message.id} className="group relative pl-3 sm:pl-5 border-l-2 border-transparent hover:border-accent/25 transition-colors animate-msg-in">
      <div className="flex items-center gap-2 mb-2 text-xs text-fg-subtle">
        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
        <span className="font-medium text-fg-muted">Assistant</span>
        {message.model && <span className="text-fg-subtle/80 font-mono text-[10px]">{message.model}</span>}
        {settings.showTokenUsage && message.usage && (
          <span className="text-fg-subtle/80 text-[10px] tabular-nums">{message.usage.totalTokens.toLocaleString()} tok</span>
        )}
        {message.error && (
          <span className="inline-flex items-center gap-1 text-danger text-[10px] font-medium bg-danger/10 px-1.5 py-0.5 rounded-full">error</span>
        )}
      </div>

      {combinedReasoning && settings.showReasoning && (
        <ThinkingDisclosure text={combinedReasoning} />
      )}

      {typeof cleanContent === 'string' && cleanContent && (
        <div className="prose-hive select-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            // KaTeX must run BEFORE highlight — otherwise hljs wraps the math
            // code nodes in spans and KaTeX can no longer parse them.
            rehypePlugins={[rehypeKatex, rehypeHighlight]}
            components={{
              a: ({ href, children }) => (
                <a href={href} onClick={(e) => { e.preventDefault(); if (href) void window.hive.openExternal(href); }}>
                  {children}
                </a>
              ),
              pre: ({ children }) => {
                const codeChild = (children as { props?: { className?: string; children?: React.ReactNode } }[])?.[0]?.props
                  ?? (children as { props?: { className?: string; children?: React.ReactNode } })?.props;
                const lang = (codeChild?.className || '').replace('language-', '') || 'text';
                // With rehype-highlight the code's children are element arrays,
                // not a plain string — extract text recursively.
                const codeText = reactNodeToText(codeChild?.children);
                if (lang === 'mermaid') return <MermaidBlock code={codeText} />;
                return <CodeBlock language={lang} code={codeText} />;
              }
            }}
          >
            {cleanContent}
          </ReactMarkdown>
        </div>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-2 space-y-1">
          {message.toolCalls.map((tc) => {
            const result = pendingToolResults.get(`${message.id}:${tc.id}`);
            return (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                result={result?.result}
                isError={result?.isError}
                durationMs={result?.durationMs}
              />
            );
          })}
        </div>
      )}

      {currentConversationId && (
        <MessageActions
          copied={msgCopied}
          bookmarked={bookmarked}
          onCopy={() => void copyMessage()}
          onFork={() => void forkFromHere()}
          onRevert={() => void revertToHere()}
          onBookmark={() => void toggleBookmark()}
        />
      )}
    </div>
  );
}

function MessageActions({ copied, bookmarked, onCopy, onFork, onRevert, onBookmark }: {
  copied: boolean;
  bookmarked: boolean;
  onCopy: () => void;
  onFork: () => void;
  onRevert: () => void;
  onBookmark: () => void;
}): JSX.Element {
  return (
    <div className={`${bookmarked ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity mt-1.5 flex items-center gap-2`}>
      <button
        onClick={onCopy}
        className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg hover:bg-bg-elev px-1.5 py-0.5 rounded transition-colors"
        title="Copy message"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        onClick={onFork}
        className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-accent hover:bg-bg-elev px-1.5 py-0.5 rounded transition-colors"
        title="Fork conversation from here"
      >
        <ForkIcon />
        Fork
      </button>
      <button
        onClick={onRevert}
        className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-danger hover:bg-bg-elev px-1.5 py-0.5 rounded transition-colors"
        title="Revert conversation to this message"
      >
        <RevertIcon />
        Revert
      </button>
      <button
        onClick={onBookmark}
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
          bookmarked ? 'text-warn' : 'text-fg-subtle hover:text-warn hover:bg-bg-elev'
        }`}
        title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
      >
        <StarIcon filled={bookmarked} />
        {bookmarked ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M6 1.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1L6 8.6 3.2 10.1l.6-3.1L1.5 4.8l3.1-.4z" />
    </svg>
  );
}

function ForkIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v5a3 3 0 003 3h4M10 10l-2-2M10 10l-2 2" />
    </svg>
  );
}

function RevertIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6h8M5 3L2 6l3 3" />
    </svg>
  );
}

function reactNodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return reactNodeToText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return '';
}

function messageContentToText(content: Msg['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? p.text : p.type === 'file' ? p.file.filename : ''))
    .filter(Boolean)
    .join('\n');
}

export function ThinkingDisclosure({ text, streaming }: { text: string; streaming?: boolean }): JSX.Element {
  return (
    <details className="mb-2 group/think">
      <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-border/70 bg-bg-elev/60 text-[10px] text-fg-subtle hover:text-fg-muted hover:border-border-strong transition select-none">
        <svg
          width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
          className="transition-transform group-open/think:rotate-90"
        >
          <path d="M2 1l4 3-4 3z" />
        </svg>
        <span className={streaming ? 'shimmer-text' : ''}>{streaming ? 'Thinking…' : 'Thought process'}</span>
      </summary>
      <div className="mt-2 ml-1 pl-3 border-l-2 border-border text-[11.5px] text-fg-subtle whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
        {text}
      </div>
    </details>
  );
}

function UserContent({ content }: { content: Msg['content'] }): JSX.Element {
  if (typeof content === 'string') return <div className="whitespace-pre-wrap text-sm text-fg leading-relaxed">{content}</div>;
  return (
    <div className="space-y-2">
      {content.map((p, i) => {
        if (p.type === 'text') return <div key={i} className="whitespace-pre-wrap text-sm text-fg leading-relaxed">{p.text}</div>;
        if (p.type === 'image_url') {
          const url = p.image_url.url;
          return <img key={i} src={url} alt="attached" className="rounded-lg max-w-full max-h-96" />;
        }
        if (p.type === 'input_audio') {
          return <audio key={i} controls src={`data:audio/wav;base64,${p.input_audio.data}`} className="w-full" />;
        }
        if (p.type === 'file') {
          return (
            <div key={i} className="inline-flex items-center gap-1.5 text-xs text-fg-muted bg-bg-elev border border-border rounded-md px-2 py-1">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                <path d="M3 1h4l2 2v8H3z" />
                <path d="M7 1v2h2" />
              </svg>
              {p.file.filename}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="my-3 rounded-[10px] overflow-hidden border border-border bg-bg-code shadow-elev-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-sidebar/80 border-b border-border">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-mono font-medium">{language}</span>
        <button
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev transition"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5A1 1 0 007 1.5H2.5a1 1 0 00-1 1V7a1 1 0 001 1H4" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
      <path d="M2 6.5L4.5 9 10 3.5" />
    </svg>
  );
}
