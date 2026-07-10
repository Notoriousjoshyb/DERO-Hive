import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { Attachment } from '@shared/types';
import { ComposerToolbar } from './ComposerToolbar';
import { ComposerAutocomplete } from './ComposerAutocomplete';
import { TokenUsageBar, ContextIndicator } from './TokenUsage';

interface Props {
  conversationId?: string;
  hasMessages: boolean;
}

const PLACEHOLDER = 'Ask anything…';
const HELP_HINTS = [
  { key: '@', label: 'files/agents' },
  { key: '/', label: 'commands' },
  { key: '!', label: 'shell' },
  { key: '#', label: 'snippets' }
];

export function InputBar({ conversationId, hasMessages }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const skills = useAppStore((s) => s.skills);
  const pendingAttachments = useAppStore((s) => s.pendingAttachments);
  const addAttachment = useAppStore((s) => s.addAttachment);
  const removeAttachment = useAppStore((s) => s.removeAttachment);
  const clearAttachments = useAppStore((s) => s.clearAttachments);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const startStreaming = useAppStore((s) => s.startStreaming);
  const abortChat = useAppStore((s) => s.abortChat);

  const composerFocusMode = useAppStore((s) => s.composerFocusMode);
  const composerPlanMode = useAppStore((s) => s.composerPlanMode);
  const composerReasoning = useAppStore((s) => s.composerReasoning);

  const [text, setText] = useState('');
  const [ghModal, setGhModal] = useState<{ url: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = composerFocusMode ? 600 : 220;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [text, composerFocusMode]);

  // Global keyboard: Escape exits focus mode
  useEffect(() => {
    if (!composerFocusMode) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useAppStore.getState().toggleComposerFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerFocusMode]);

  // Focus textarea on mount and conversation change
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focus = (): void => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (document.activeElement === ta) return;
      ta.focus({ preventScroll: true });
      if (document.activeElement !== ta) ta.focus();
    };
    focus();
    const t1 = setTimeout(focus, 50);
    const t2 = setTimeout(focus, 250);
    const t3 = setTimeout(focus, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [conversationId]);

  // Click-to-focus: clicking the padding around the textarea focuses it and
  // moves the caret to the end. Clicks ON the textarea (or buttons) are left
  // alone so normal text selection / caret placement works.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      const ta = textareaRef.current;
      if (!ta) return;
      // Only intercept clicks that aren't on interactive/text elements.
      if (target === ta || ta.contains(target)) return;
      if (target.closest('button, input, textarea, [contenteditable], a')) return;
      e.preventDefault();
      ta.focus({ preventScroll: true });
      const len = ta.value.length;
      try { ta.setSelectionRange(len, len); } catch { /* ignore */ }
    };
    wrap.addEventListener('mousedown', onMouseDown);
    return () => wrap.removeEventListener('mousedown', onMouseDown);
  }, []);

  const submit = async (): Promise<void> => {
    const content = text.trim();
    if (!content) return;
    const state = useAppStore.getState();
    if (state.isStreaming) return;

    let providerId = state.selectedProviderId;
    let model = state.selectedModel;
    if (!providerId && state.providers.length > 0) providerId = state.providers[0].id;
    if (providerId) {
      const p = state.providers.find((pp) => pp.id === providerId);
      if (!model && p?.models?.length) model = p.models[0].id;
      if (model && p && !p.models.find((m) => m.id === model)) model = p.models[0]?.id;
      if (providerId !== state.selectedProviderId || model !== state.selectedModel) state.setSelection(providerId, model);
    }
    if (!providerId) { state.setChatError('Add a provider in Settings → Providers first.'); return; }
    if (!model) { state.setChatError(`No model available for "${providerId}".`); return; }

    state.setChatError(null);

    let prompt = content;
    let skillName: string | undefined;
    let extractedText: string | null = null;
    const m = content.match(/^(\/\S+)\s*([\s\S]*)/);
    if (m) {
      const cmd = m[1];
      const rest = m[2];
      const skill = skills.find((s) => s.slashCommand === cmd && s.enabled);
      if (skill) { prompt = `${skill.prompt}\n\n${rest}`; skillName = skill.name; }
    }

    // Run shell command prefixed with !cmd — the whole line after "!" is the command
    const shellMatch = content.match(/^!(\S[\s\S]*)/);
    if (shellMatch) {
      const shellCmd = shellMatch[1].trim();
      try {
        const r = await window.hive.shellRun(shellCmd);
        const out = (r.ok ? r.stdout : r.error || r.stderr) || '(no output)';
        extractedText = out;
        prompt = `Shell command output for "${shellCmd}":\n${out}\n\nExplain what this output shows.`;
      } catch (err) {
        prompt = `Shell command failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Plan-mode system prompt
    let systemPrompt = skillName ? `Active skill: ${skillName}` : undefined;
    if (composerPlanMode && !skillName) {
      systemPrompt = (systemPrompt ? systemPrompt + '\n' : '') +
        'Plan mode is enabled. Think step-by-step and present a plan (numbered steps) before taking any action. Wait for user confirmation before executing tools.';
    }

    let convId = conversationId;
    if (!convId) {
      // Inherit projectId from the most recent conversation if it had one set
      const recentWithProject = useAppStore.getState().conversations.find((c) => c.projectId);
      const projectId = recentWithProject?.projectId;
      convId = await useAppStore.getState().createConversation({
        title: content.slice(0, 60),
        projectId
      });
    } else {
      // Only auto-title untouched conversations — never clobber a name the
      // user chose (or one already derived from the first message).
      const conv = useAppStore.getState().conversations.find((c) => c.id === convId);
      const isDefaultTitle = !conv?.title || conv.title === 'New chat' || conv.title === 'New conversation';
      if (isDefaultTitle) {
        await useAppStore.getState().updateConversation(convId, { title: content.slice(0, 60) });
      }
    }

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: pendingAttachments.length > 0
        ? [
            { type: 'text', text: prompt },
            ...pendingAttachments.map((a) =>
              a.type === 'image' ? { type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.data}` } } :
              a.type === 'audio' ? { type: 'input_audio', input_audio: { data: a.data, format: 'mp3' as const } } :
              { type: 'file', file: { filename: a.filename, data: a.data, mimeType: a.mimeType } }
            )
          ]
        : prompt,
      createdAt: Date.now()
    };
    void extractedText;

    useAppStore.setState((s) => ({ currentMessages: [...s.currentMessages, userMsg as never] }));
    const messagesToSend = useAppStore.getState().currentMessages;

    try {
      const reasoning = composerReasoning === 'off' ? undefined : { effort: composerReasoning };
      const { messageId } = await window.hive.chatSend({
        conversationId: convId,
        providerId,
        model,
        messages: messagesToSend,
        attachments: pendingAttachments.map((a) => ({ type: a.type, filename: a.filename, mimeType: a.mimeType, data: a.data })),
        systemPrompt,
        planMode: composerPlanMode || undefined,
        toolApprovalModeOverride: settings.toolApprovalMode,
        reasoning
      });
      setText('');
      clearAttachments();
      startStreaming(messageId);
      void useAppStore.getState().loadConversations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().setChatError(msg);
      useAppStore.setState((s) => ({ isStreaming: false }));
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && settings.sendOnEnter) {
      e.preventDefault();
      void submit();
    }
  };

  const attachFiles = async (): Promise<void> => {
    try {
      const files = await window.hive.attachFromFile();
      if (files) {
        for (const f of files) {
          addAttachment({
            id: crypto.randomUUID(),
            type: f.type as Attachment['type'],
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.data.length,
            data: f.data
          });
        }
      }
    } catch (err) { console.error('attach failed', err); }
  };

  const stop = (): void => {
    void abortChat();
  };

  // Live dictation: VoiceInput emits the full transcript of the current
  // utterance on each update (interim + final). We capture the text present
  // when dictation started and replace everything after it, so words appear
  // as they're spoken and the final result cleanly commits.
  const dictationBaseRef = useRef<string | null>(null);
  const onVoiceResult = (transcript: string, isFinal: boolean): void => {
    setText((cur) => {
      if (dictationBaseRef.current === null) {
        dictationBaseRef.current = cur && !/\s$/.test(cur) ? cur + ' ' : cur;
      }
      return dictationBaseRef.current + transcript;
    });
    if (isFinal) dictationBaseRef.current = null;
  };

  const openGhModal = (): void => {
    const url = window.prompt('Paste a GitHub issue or PR URL:');
    if (url) setGhModal({ url });
  };

  return (
    <div className={`border-t border-border bg-bg p-4 input-bar-offset ${composerFocusMode ? 'fixed inset-x-0 bottom-0 z-40 shadow-2xl' : ''}`}>
      <div className={`mx-auto ${composerFocusMode ? 'max-w-4xl' : 'max-w-3xl'}`}>
        <div className="flex items-center justify-between mb-1 px-1">
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <TokenUsageBar />
            <span className="text-fg-subtle/30">|</span>
            <ContextIndicator promptChars={text.length} />
          </div>
        </div>
        <ComposerAutocomplete text={text} setText={setText} textareaRef={textareaRef} />

        {ghModal && <GhPreviewModal url={ghModal.url} onClose={() => setGhModal(null)} onInsert={(md) => {
          setText((t) => t + (t ? '\n\n' : '') + md);
          setGhModal(null);
        }} />}

        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 bg-bg-elev border border-border rounded-lg pl-1.5 pr-1 py-1 text-xs shadow-elev-sm animate-fade-in">
                {a.type === 'image' ? (
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.filename} className="w-7 h-7 object-cover rounded-md" />
                ) : (
                  <span className="w-7 h-7 rounded-md bg-accent-soft text-accent flex items-center justify-center text-[9px] font-mono uppercase">{a.type.slice(0, 3)}</span>
                )}
                <span className="text-fg-muted truncate max-w-32">{a.filename}</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="w-5 h-5 rounded-md flex items-center justify-center text-fg-subtle hover:text-danger hover:bg-danger/10 transition"
                  title="Remove attachment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          ref={wrapperRef}
          className={`bg-bg-input border rounded-2xl shadow-composer transition-all duration-200 focus-within:border-accent/70 focus-within:shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-composer)] ${composerFocusMode ? 'border-accent/60' : 'border-border'}`}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={composerFocusMode ? 8 : 3}
            spellCheck
            autoFocus
            tabIndex={0}
            placeholder={hasMessages ? 'Reply…' : PLACEHOLDER}
            readOnly={isStreaming}
            aria-label="Message input"
            className="w-full resize-none px-4 pt-3 pb-1.5 bg-transparent text-fg placeholder-fg-subtle focus:outline-none text-sm leading-relaxed caret-accent"
          />
          {!text && !isStreaming && (
            <div className="flex items-center gap-3 px-4 pb-2 text-[10px] text-fg-subtle/60 select-none">
              {HELP_HINTS.map((h) => (
                <span key={h.key} className="inline-flex items-center gap-1">
                  <kbd className="font-mono min-w-[16px] text-center px-1 py-0.5 rounded-md bg-bg-sidebar border border-border/80 text-fg-muted text-[9px] leading-none shadow-elev-sm">{h.key}</kbd>
                  <span>{h.label}</span>
                </span>
              ))}
            </div>
          )}
          <ComposerToolbar
            isStreaming={isStreaming}
            onSend={() => void submit()}
            onStop={stop}
            onAttach={attachFiles}
            onAttachGh={openGhModal}
            onVoiceResult={onVoiceResult}
            canSend={text.trim().length > 0}
            focusComposer={() => textareaRef.current?.focus({ preventScroll: true })}
          />
        </div>
        {!composerFocusMode && (
          <div className="text-[10px] text-fg-subtle/70 mt-2 text-center">
            Hive can make mistakes. Verify important information.
          </div>
        )}
      </div>
    </div>
  );
}

function GhPreviewModal({ url, onClose, onInsert }: { url: string; onClose: () => void; onInsert: (md: string) => void }): JSX.Element {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.hive.ghFetchUrl>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.hive.ghFetchUrl(url).then((res) => { if (!cancelled) setData(res); }).catch(() => { if (!cancelled) setData({ error: 'fetch failed' } as never); });
    return () => { cancelled = true; };
  }, [url]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-bg-elev border border-border rounded-xl shadow-2xl max-w-2xl w-full p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-fg">GitHub reference</h3>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg">×</button>
        </div>
        {!data && <div className="text-xs text-fg-muted">Fetching {url}…</div>}
        {data && 'error' in data && <div className="text-xs text-danger">{data.error}</div>}
        {data && !('error' in data) && (
          <>
            <div className="text-sm">
              <span className="font-mono text-accent text-xs uppercase mr-2">{data.type === 'pr' ? 'PR' : 'Issue'}</span>
              <span className="font-medium">{data.title}</span>
            </div>
            <div className="text-[10px] text-fg-subtle">
              {data.repo}#{data.number} · {data.author} · <span className={data.state === 'open' ? 'text-success' : data.state === 'merged' ? 'text-accent' : 'text-fg-subtle'}>{data.state}</span>
              {data.labels.length > 0 && ' · ' + data.labels.map((l) => `[${l}]`).join(' ')}
            </div>
            <pre className="text-xs text-fg-muted bg-bg p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">{data.body.slice(0, 2000)}{data.body.length > 2000 ? '…[truncated]' : ''}</pre>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-1 text-xs rounded border border-border hover:bg-bg-input text-fg-muted">Cancel</button>
              <button
                onClick={() => onInsert(`[GitHub ${data.type === 'pr' ? 'PR' : 'Issue'}: ${data.title}](${data.url})\n\n${data.body.slice(0, 1500)}${data.body.length > 1500 ? '…' : ''}`)}
                className="px-3 py-1 text-xs rounded bg-accent text-white hover:opacity-90"
              >Insert into composer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}