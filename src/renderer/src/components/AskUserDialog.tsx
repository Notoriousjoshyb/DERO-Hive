import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserQuestionAnswer, UserQuestionRequest } from '@shared/types';

/**
 * The model asking the human mid-turn (`ask_user_question`). One request may
 * carry several questions; all are answered together and returned as one batch,
 * so the tool call unparks once.
 *
 * Options are the common case, but a question with none falls back to free
 * text — a UI that renders it either way replies with the same answer shape.
 */
export function AskUserDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<UserQuestionRequest[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const firstFieldRef = useRef<HTMLButtonElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const off = window.hive.onUserQuestion((req) => setQueue((q) => [...q, req]));
    return () => { off(); };
  }, []);

  const req = queue[0];

  // Reset the working answers whenever a new request reaches the front.
  useEffect(() => {
    setSelected({});
    setFreeText({});
    submitting.current = false;
    if (req) requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [req?.requestId]);

  const submit = useCallback(async (): Promise<void> => {
    if (!req || submitting.current) return;
    submitting.current = true;
    const answers: UserQuestionAnswer[] = req.questions.map((q) => {
      const picked = selected[q.id] ?? [];
      const typed = (freeText[q.id] ?? '').trim();
      // A typed reply counts even when options exist — the user may have more
      // to say than the model anticipated.
      const combined = typed ? [...picked, typed] : picked;
      return { id: q.id, answers: combined };
    });
    setQueue((rest) => rest.slice(1));
    await window.hive.answerUserQuestion(req.requestId, answers);
  }, [req, selected, freeText]);

  if (!req) return null;

  const toggle = (qid: string, label: string, multi: boolean): void => {
    setSelected((prev) => {
      const cur = prev[qid] ?? [];
      if (!multi) return { ...prev, [qid]: cur[0] === label ? [] : [label] };
      return { ...prev, [qid]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  const answerable = req.questions.every((q) => {
    const hasPick = (selected[q.id] ?? []).length > 0;
    const hasText = (freeText[q.id] ?? '').trim().length > 0;
    return hasPick || hasText;
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center px-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="The assistant has a question"
    >
      <div className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg max-w-lg w-full max-h-[80vh] overflow-y-auto p-5 animate-slide-up">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center text-accent flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 6a2 2 0 113 1.7c-.6.4-1 .8-1 1.6" />
              <path d="M8 11.5v.01" />
              <circle cx="8" cy="8" r="6.5" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-fg">
              {req.questions.length > 1 ? `${req.questions.length} questions before continuing` : 'A question before continuing'}
            </h3>
            <p className="text-xs text-fg-muted mt-0.5">The assistant is paused until you answer.</p>
          </div>
        </div>

        <div className="space-y-5">
          {req.questions.map((q, qi) => (
            <div key={q.id}>
              {q.header && (
                <div className="text-[10px] uppercase tracking-wide text-fg-subtle font-medium mb-1">{q.header}</div>
              )}
              <p className="text-sm text-fg mb-2.5 leading-relaxed">{q.question}</p>

              {q.options && q.options.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {q.options.map((opt, oi) => {
                    const isPicked = (selected[q.id] ?? []).includes(opt.label);
                    return (
                      <button
                        key={opt.label}
                        ref={qi === 0 && oi === 0 ? (firstFieldRef as React.RefObject<HTMLButtonElement>) : undefined}
                        onClick={() => toggle(q.id, opt.label, !!q.multiSelect)}
                        aria-pressed={isPicked}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition ${
                          isPicked
                            ? 'border-accent bg-accent-soft text-fg'
                            : 'border-border bg-bg hover:bg-bg-input hover:border-border-strong text-fg'
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="block text-xs text-fg-muted mt-0.5 leading-relaxed">{opt.description}</span>
                        )}
                      </button>
                    );
                  })}
                  {q.multiSelect && <p className="text-[11px] text-fg-subtle">Choose as many as apply.</p>}
                </div>
              )}

              <textarea
                ref={qi === 0 && !q.options?.length ? (firstFieldRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                value={freeText[q.id] ?? ''}
                onChange={(e) => setFreeText((p) => ({ ...p, [q.id]: e.target.value }))}
                rows={q.options?.length ? 2 : 3}
                placeholder={q.options?.length ? 'Or answer in your own words…' : 'Your answer…'}
                aria-label={q.question}
                className="w-full resize-none rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent transition"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <span className="text-[11px] text-fg-subtle mr-auto">
            Cancel the turn from the composer to dismiss without answering.
          </span>
          <button
            onClick={() => void submit()}
            disabled={!answerable}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium shadow-elev-sm transition"
          >
            Send answer
          </button>
        </div>
      </div>
    </div>
  );
}
