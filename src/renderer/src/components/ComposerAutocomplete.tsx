import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { PromptTemplate } from '@shared/types';

export type TriggerKind = 'files' | 'skills' | 'shell' | 'snippets';

interface TriggerState {
  kind: TriggerKind;
  prefix: string;
  query: string;
  start: number; // index in text where the trigger starts
}

interface FileMatch { path: string; rel: string; filename: string }
interface SkillMatch { id: string; name: string; slashCommand: string; description: string; isCustom?: boolean; source?: string }
interface GhMatch { type: 'issue' | 'pr'; number: number; title: string; state: 'open' | 'closed' | 'merged'; author: string; url: string; repo: string }

interface Props {
  text: string;
  setText: (t: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** InputBar calls this from the textarea's onKeyDown; a `true` return means the event was consumed by the menu. */
  keyHandlerRef?: React.MutableRefObject<((e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean) | null>;
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

// Subsequence fuzzy scorer. Returns -1 when the query isn't a subsequence of
// the target; otherwise a score where consecutive runs, word-boundary hits,
// and shorter targets rank higher.
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -1;
    score += 1;
    if (idx === lastMatch + 1) score += 3; // consecutive run
    if (idx === 0 || /[\s/\\._-]/.test(t[idx - 1])) score += 2; // word boundary
    lastMatch = idx;
    ti = idx + 1;
  }
  // Prefer shorter targets and earlier first-matches
  return score * 100 - t.length - t.indexOf(q[0]);
}

export function ComposerAutocomplete({ text, setText, textareaRef, keyHandlerRef }: Props): JSX.Element | null {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [ghCards, setGhCards] = useState<GhMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const skills = useAppStore((s) => s.skills);
  const customCommands = useAppStore((s) => s.customCommands);
  const prompts = useAppStore((s) => s.prompts);
  const setting = useAppStore((s) => s.settings);

  const caret = textareaRef.current?.selectionStart ?? text.length;

  useEffect(() => {
    setTrigger(detectTrigger(text, caret));
  }, [text, caret]);

  // Escape hides the menu until the user starts a new trigger.
  useEffect(() => {
    setDismissed(false);
  }, [trigger?.start, trigger?.prefix]);

  // Load files / snippets when trigger changes
  useEffect(() => {
    if (!trigger) { setFiles([]); setGhCards([]); return; }
    if (trigger.kind === 'files') {
      const q = trigger.query;
      const isUrl = /^https?:\/\//.test(q) || GITHUB_URL_RE.test(q);
      if (!isUrl && q.length >= 2) {
        setLoading(true);
        // Interleave "*" so the main-process glob (which maps * → .*) does
        // subsequence matching; exact ranking happens client-side below.
        const fuzzyPattern = q.split('').join('*');
        window.hive.fsGlob({ pattern: fuzzyPattern, limit: 60, root: setting.workingDirectory })
          .then((res) => { setFiles(res as FileMatch[]); setLoading(false); })
          .catch(() => setLoading(false));
      } else {
        setFiles([]);
      }
      if (GITHUB_URL_RE.test(q)) {
        const full = q.startsWith('http') ? q : `https://${q}`;
        window.hive.ghFetchUrl(full).then((res) => {
          if (!('error' in res)) {
          const gh = res as GhMatch;
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
    const q = trigger.query;
    if (trigger.kind === 'skills') {
      const q = trigger.query;
      const skillItems = skills
        .filter((s) => s.enabled)
        .map((s) => ({ item: s, score: Math.max(fuzzyScore(q, s.slashCommand), fuzzyScore(q, s.name)) }))
        .filter((r) => r.score >= 0)
        .map((r) => r.item);
      const commandItems = customCommands
        .map((c) => ({ item: { id: c.id, name: c.name, slashCommand: c.slashCommand, description: c.description || 'Custom command', isCustom: true, source: c.source }, score: Math.max(fuzzyScore(q, c.slashCommand), fuzzyScore(q, c.name)) }))
        .filter((r) => r.score >= 0)
        .map((r) => r.item);
      return [...skillItems, ...commandItems].sort((a, b) => {
        const aScore = Math.max(fuzzyScore(q, a.slashCommand), fuzzyScore(q, a.name));
        const bScore = Math.max(fuzzyScore(q, b.slashCommand), fuzzyScore(q, b.name));
        return bScore - aScore;
      });
    }
    if (trigger.kind === 'shell') {
      return q ? [] : [{ id: 'shell-hint', label: 'Run shell command and paste output as context', action: 'shellHint' }];
    }
    if (trigger.kind === 'snippets') {
      if (prompts.length === 0) {
        return q ? [] : [{ id: 'snip-hint', label: 'No prompts yet — add some in Settings → Prompts', action: 'snippetHint' }];
      }
      return prompts
        .map((p) => ({ item: p, score: Math.max(fuzzyScore(q, p.title), p.category ? fuzzyScore(q, p.category) : -1) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((r) => r.item);
    }
    if (trigger.kind === 'files') {
      return files
        .map((f) => ({ item: f, score: fuzzyScore(q, f.rel) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map((r) => r.item);
    }
    return [];
  }, [trigger, skills, files, prompts]);

  // Keep the highlighted row valid as results shrink.
  useEffect(() => {
    if (idx >= matches.length) setIdx(Math.max(0, matches.length - 1));
  }, [matches.length, idx]);

  const applyMatch = (m: SkillMatch | FileMatch | PromptTemplate | { id: string }): void => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const commit = (insert: string): void => {
      setText(before + insert + after);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          const pos = before.length + insert.length;
          ta.focus();
          try { ta.setSelectionRange(pos, pos); } catch { /* ignore */ }
        }
      }, 0);
    };
    if (trigger.kind === 'skills') commit((m as SkillMatch).slashCommand + ' ');
    else if (trigger.kind === 'files') commit(`@${(m as FileMatch).rel} `);
    else if (trigger.kind === 'snippets' && 'content' in m) {
      // Prompt templates interpolate variables at insert time (clipboard is async).
      void interpolatePrompt((m as PromptTemplate).content).then(commit);
    } else commit(trigger.prefix + ' ');
  };

  // Register the keyboard handler InputBar consults before Enter-to-send.
  const menuVisible = !!trigger && !dismissed && matches.length > 0 &&
    (trigger.kind === 'skills' || trigger.kind === 'files' || (trigger.kind === 'snippets' && prompts.length > 0));
  useEffect(() => {
    if (!keyHandlerRef) return;
    keyHandlerRef.current = (e) => {
      if (!menuVisible) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const m = matches[idx] || matches[0];
        if (m) applyMatch(m as SkillMatch | FileMatch);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return true;
      }
      return false;
    };
    return () => { keyHandlerRef.current = null; };
  });

  if (!trigger || dismissed) return null;

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
          onClick={() => {
            if (!trigger) return;
            const before = text.slice(0, trigger.start);
            const after = text.slice(caret);
            const insert = `\n\n[GitHub ${c.type === 'pr' ? 'PR' : 'Issue'}: ${c.title}](${c.url})\n`;
            setText(before + insert + after);
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          className="w-full text-left px-3 py-2 text-xs text-fg-muted hover:bg-bg-input"
        >
          Insert as markdown reference
        </button>
      </div>
    );
  }

  if (!matches.length && !loading) {
    if (trigger.kind === 'files' && trigger.query.length === 1) {
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
      {(matches as Array<SkillMatch | FileMatch | PromptTemplate | { id: string; label: string; action: string }>).map((m, i) => (
        <button
          key={trigger.kind === 'files' ? (m as FileMatch).path : (m as { id: string }).id}
          onMouseDown={(e) => { e.preventDefault(); }}
          onMouseEnter={() => setIdx(i)}
          onClick={() => applyMatch(m)}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === idx ? 'bg-accent/10' : ''} hover:bg-bg-input`}
        >
          {trigger.kind === 'skills' && (
            <>
              <span className="text-accent font-mono text-sm">{(m as SkillMatch).slashCommand}</span>
              <span className="text-fg text-sm truncate">{(m as SkillMatch).name}</span>
              {(m as SkillMatch).isCustom && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-bg-input border border-border text-fg-subtle flex-shrink-0">Custom</span>
              )}
              <span className="text-[10px] text-fg-subtle truncate flex-1">{(m as SkillMatch).description}</span>
            </>
          )}
          {trigger.kind === 'files' && (
            <>
              <span className="text-fg-subtle font-mono text-[11px]">📄</span>
              <span className="text-fg-muted font-mono text-xs truncate">
                <HighlightedPath rel={(m as FileMatch).rel} query={trigger.query} />
              </span>
            </>
          )}
          {trigger.kind === 'snippets' && 'content' in m && (
            <>
              <span className="text-accent font-mono text-xs">#</span>
              <span className="text-fg text-sm truncate">{(m as PromptTemplate).title}</span>
              {(m as PromptTemplate).category && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-bg-input border border-border text-fg-subtle flex-shrink-0">{(m as PromptTemplate).category}</span>
              )}
              <span className="text-[10px] text-fg-subtle truncate flex-1">{(m as PromptTemplate).content.replace(/\s+/g, ' ').slice(0, 60)}</span>
            </>
          )}
          {(trigger.kind === 'shell' || (trigger.kind === 'snippets' && !('content' in m))) && (
            <>
              <span className="text-fg-subtle text-xs">⚡</span>
              <span className="text-fg-muted text-xs">{(m as { label: string }).label}</span>
            </>
          )}
        </button>
      ))}
      {menuVisible && (
        <div className="px-3 py-1 text-[9px] text-fg-subtle border-t border-border/50 flex items-center gap-2">
          <span>↑↓ navigate</span>
          <span>Tab/Enter select</span>
          <span>Esc dismiss</span>
        </div>
      )}
    </div>
  );
}

// Fill prompt-template variables at insert time. Clipboard access is async
// and may be denied — an empty string is substituted in that case.
async function interpolatePrompt(content: string): Promise<string> {
  let out = content;
  if (out.includes('{{clipboard}}')) {
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch { /* permission denied */ }
    out = out.split('{{clipboard}}').join(clip);
  }
  out = out.split('{{date}}').join(new Date().toLocaleDateString());
  return out;
}

// Bold the characters of `query` where they (case-insensitively) match the
// displayed path as a subsequence — mirrors fuzzyScore's greedy matching.
function HighlightedPath({ rel, query }: { rel: string; query: string }): JSX.Element {
  if (!query) return <>{rel}</>;
  const q = query.toLowerCase();
  const t = rel.toLowerCase();
  const hits = new Set<number>();
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return <>{rel}</>;
    hits.add(idx);
    ti = idx + 1;
  }
  return (
    <>
      {rel.split('').map((ch, i) =>
        hits.has(i) ? <b key={i} className="text-fg font-semibold">{ch}</b> : <span key={i}>{ch}</span>
      )}
    </>
  );
}
