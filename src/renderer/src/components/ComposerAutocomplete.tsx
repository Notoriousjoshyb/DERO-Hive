import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';

export type TriggerKind = 'files' | 'skills' | 'shell' | 'snippets';

interface TriggerState {
  kind: TriggerKind;
  prefix: string;
  query: string;
  start: number; // index in text where the trigger starts
}

interface FileMatch { path: string; rel: string; filename: string }
interface SkillMatch { id: string; name: string; slashCommand: string; description: string }
interface GhMatch { type: 'issue' | 'pr'; number: number; title: string; state: 'open' | 'closed' | 'merged'; author: string; url: string; repo: string }

interface Props {
  text: string;
  setText: (t: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const GITHUB_URL_RE = /(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/;

export function detectTrigger(text: string, caret: number): TriggerState | null {
  // Look back from caret to find the start of the current word/phrase
  const before = text.slice(0, caret);
  const m = before.match(/(^|[\s])(\/|@|!|#)([^\s/]*)$/);
  if (!m) return null;
  const start = before.lastIndexOf(m[1] + m[2]) + m[1].length;
  const prefix = m[2];
  const query = m[3];
  const kind: TriggerKind =
    prefix === '/' ? 'skills' :
    prefix === '@' ? 'files' :
    prefix === '!' ? 'shell' : 'snippets';
  return { kind, prefix, query, start };
}

export function ComposerAutocomplete({ text, setText, textareaRef }: Props): JSX.Element | null {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [idx, setIdx] = useState(0);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [ghCards, setGhCards] = useState<GhMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const skills = useAppStore((s) => s.skills);
  const setting = useAppStore((s) => s.settings);

  const caret = textareaRef.current?.selectionStart ?? text.length;

  useEffect(() => {
    setTrigger(detectTrigger(text, caret));
  }, [text, caret]);

  // Load files / snippets when trigger changes
  useEffect(() => {
    if (!trigger) { setFiles([]); setGhCards([]); return; }
    if (trigger.kind === 'files') {
      const q = trigger.query;
      const isUrl = /^https?:\/\//.test(q) || GITHUB_URL_RE.test(q);
      if (isUrl || (trigger.prefix === '@' && q.length >= 3)) {
        setLoading(true);
        window.hive.fsGlob({ pattern: q || '*', limit: 30, root: setting.workingDirectory })
          .then((res) => { setFiles(res as FileMatch[]); setLoading(false); })
          .catch(() => setLoading(false));
      } else {
        setFiles([]);
      }
      if (GITHUB_URL_RE.test(q)) {
        const full = q.startsWith('http') ? q : `https://${q}`;
        window.hive.ghFetchUrl(full).then((res) => {
          if (!('error' in res)) {
            const gh = res as unknown as GhMatch & { repo: string };
            setGhCards([{ type: gh.type, number: gh.number, title: gh.title, state: gh.state, author: gh.author, url: gh.url, repo: gh.repo }]);
          }
        }).catch(() => {});
      } else {
        setGhCards([]);
      }
    }
    setIdx(0);
  }, [trigger?.start, trigger?.query, trigger?.kind]);

  const matches = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.kind === 'skills') {
      return skills.filter((s) => s.enabled && (s.slashCommand.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    }
    if (trigger.kind === 'shell') {
      return q ? [] : [{ id: 'shell-hint', label: 'Run shell command and paste output as context', action: 'shellHint' }];
    }
    if (trigger.kind === 'snippets') {
      return q ? [] : [{ id: 'snip-hint', label: 'Snippets coming soon — save and recall text templates', action: 'snippetHint' }];
    }
    if (trigger.kind === 'files') {
      return files.slice(0, 30);
    }
    return [];
  }, [trigger, skills, files]);

  const apply = (insert: string, replaceQuery?: boolean): void => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const nextText = before + insert + after;
    setText(nextText);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        const pos = before.length + insert.length;
        ta.focus();
        try { ta.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    }, 0);
    void replaceQuery;
  };

  if (!trigger) return null;

  // GitHub URL preview
  if (trigger.kind === 'files' && ghCards.length > 0) {
    const c = ghCards[0];
    return (
      <div className="mb-2 bg-bg-elev border border-border rounded-lg shadow-lg overflow-hidden">
        <div className="px-3 py-2 flex items-start gap-2 border-b border-border/50">
          <span className="text-xs font-mono text-accent uppercase">{c.type === 'pr' ? 'PR' : 'Issue'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-fg truncate">{c.title}</div>
            <div className="text-[10px] text-fg-subtle">{c.repo}#{c.number} · {c.author} · <span className={c.state === 'open' ? 'text-success' : c.state === 'merged' ? 'text-accent' : 'text-fg-subtle'}>{c.state}</span></div>
          </div>
        </div>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(`\n\n[GitHub ${c.type === 'pr' ? 'PR' : 'Issue'}: ${c.title}](${c.url})\n`, false)}
          className="w-full text-left px-3 py-2 text-xs text-fg-muted hover:bg-bg-input"
        >
          Insert as markdown reference
        </button>
      </div>
    );
  }

  if (!matches.length && !loading) {
    if (trigger.kind === 'files' && trigger.query.length >= 1 && trigger.query.length < 3) {
      return (
        <div className="mb-2 px-3 py-2 bg-bg-elev border border-border rounded-lg text-xs text-fg-subtle">
          Type a few more characters to search files…
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mb-2 bg-bg-elev border border-border rounded-lg shadow-lg overflow-hidden">
      {loading && (
        <div className="px-3 py-2 text-xs text-fg-subtle border-b border-border/50">Searching…</div>
      )}
      {(trigger.kind === 'skills' ? matches as SkillMatch[] : trigger.kind === 'files' ? matches as FileMatch[] : matches as Array<{ id: string; label: string; action: string }>).map((m, i) => (
        <button
          key={trigger.kind === 'skills' ? (m as SkillMatch).id : trigger.kind === 'files' ? (m as FileMatch).path : (m as { id: string }).id}
          onMouseDown={(e) => { e.preventDefault(); }}
          onClick={() => {
            if (trigger.kind === 'skills') {
              const sm = m as SkillMatch;
              const before = text.slice(0, trigger.start);
              const after = text.slice(caret);
              setText(before + sm.slashCommand + ' ' + after);
              setTimeout(() => textareaRef.current?.focus(), 0);
            } else if (trigger.kind === 'files') {
              const fm = m as FileMatch;
              const before = text.slice(0, trigger.start);
              const after = text.slice(caret);
              setText(before + `@${fm.rel} ` + after);
              setTimeout(() => textareaRef.current?.focus(), 0);
            } else {
              // hint rows
              const before = text.slice(0, trigger.start);
              const after = text.slice(caret);
              setText(before + trigger.prefix + ' ' + after);
              setTimeout(() => textareaRef.current?.focus(), 0);
            }
          }}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === idx ? 'bg-accent/10' : ''} hover:bg-bg-input`}
        >
          {trigger.kind === 'skills' && (
            <>
              <span className="text-accent font-mono text-sm">{(m as SkillMatch).slashCommand}</span>
              <span className="text-fg text-sm truncate">{(m as SkillMatch).name}</span>
              <span className="text-[10px] text-fg-subtle truncate flex-1">{(m as SkillMatch).description}</span>
            </>
          )}
          {trigger.kind === 'files' && (
            <>
              <span className="text-fg-subtle font-mono text-[11px]">📄</span>
              <span className="text-fg-muted font-mono text-xs truncate">{(m as FileMatch).rel}</span>
            </>
          )}
          {(trigger.kind === 'shell' || trigger.kind === 'snippets') && (
            <>
              <span className="text-fg-subtle text-xs">⚡</span>
              <span className="text-fg-muted text-xs">{(m as { label: string }).label}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
