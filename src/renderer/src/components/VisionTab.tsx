import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '../stores/app';
import type { Artifact } from '@shared/types';
import { artifactGroupKey, artifactLabel } from '../lib/artifacts';
import { renderVisionHtml } from '../lib/visionRender';
import { VisionIcon } from './VisionPanel';
import { MediaStudio } from './MediaStudio';

interface Group {
  key: string;
  versions: Artifact[]; // oldest → newest
  latest: Artifact;
}

// Full-page gallery of every saved Vision artifact across all conversations.
export function VisionTab(): JSX.Element {
  const conversations = useAppStore((s) => s.conversations);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const artifactsChangedAt = useAppStore((s) => s.artifactsChangedAt);
  const visionMode = useAppStore((s) => s.visionMode);
  const setVisionMode = useAppStore((s) => s.setVisionMode);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'current'>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    void window.hive.artifactList().then(setArtifacts);
  }, [artifactsChangedAt]);

  const convTitle = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of conversations) m.set(c.id, c.title || 'Untitled chat');
    return m;
  }, [conversations]);

  // Group versions per conversation so identically-titled artifacts from
  // different chats stay separate.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of [...artifacts].reverse()) {
      const key = `${a.conversationId}|${artifactGroupKey(a)}`;
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, versions]) => ({ key, versions, latest: versions[versions.length - 1] }))
      .sort((a, b) => b.latest.createdAt - a.latest.createdAt);
  }, [artifacts]);

  const types = useMemo(() => [...new Set(groups.map((g) => g.latest.type))], [groups]);

  const visible = groups.filter((g) => {
    if (typeFilter !== 'all' && g.latest.type !== typeFilter) return false;
    if (scopeFilter === 'current' && g.latest.conversationId !== currentConversationId) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return artifactLabel(g.latest).toLowerCase().includes(q)
      || (convTitle.get(g.latest.conversationId) || '').toLowerCase().includes(q);
  });

  const open = groups.find((g) => g.key === openKey) || null;

  return (
    <main className="flex-1 min-w-0 flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <VisionIcon size={18} />
          <h2 className="text-sm font-semibold">Vision</h2>
          {visionMode === 'artifacts' && (
            <span className="text-xs text-fg-subtle">{groups.length} saved artifact{groups.length === 1 ? '' : 's'}</span>
          )}
        </div>
        <div className="flex items-center bg-bg-elev rounded-lg p-0.5 text-[11px] ml-1">
          <button
            onClick={() => setVisionMode('artifacts')}
            className={`px-2.5 py-0.5 rounded-md transition ${visionMode === 'artifacts' ? 'bg-bg text-fg shadow-elev-sm' : 'text-fg-muted hover:text-fg'}`}
          >Artifacts</button>
          <button
            onClick={() => setVisionMode('media')}
            className={`px-2.5 py-0.5 rounded-md transition ${visionMode === 'media' ? 'bg-bg text-fg shadow-elev-sm' : 'text-fg-muted hover:text-fg'}`}
          >Media</button>
        </div>
        <div className="flex-1" />
        {visionMode === 'artifacts' && (
          <>
            <div className="flex items-center gap-1 text-[11px]">
              <FilterChip active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')}>All chats</FilterChip>
              <FilterChip active={scopeFilter === 'current'} onClick={() => setScopeFilter('current')}>Current chat</FilterChip>
              <span className="w-px h-4 bg-border mx-1" />
              <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All</FilterChip>
              {types.map((t) => (
                <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{artifactLabel({ type: t })}</FilterChip>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artifacts…"
              className="bg-bg-input border border-border rounded-lg px-3 py-1.5 text-xs w-52 focus:outline-none focus:border-accent"
            />
          </>
        )}
      </div>

      {visionMode === 'media' ? (
        <MediaStudio variant="tab" />
      ) : /* Grid */ visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-10">
          <VisionIcon size={28} className="text-fg-subtle" />
          <div className="text-sm font-medium text-fg">{groups.length === 0 ? 'Nothing saved yet' : 'No matches'}</div>
          <p className="text-xs text-fg-muted max-w-sm leading-relaxed">
            {groups.length === 0
              ? 'Artifacts created in your conversations — web apps, diagrams, documents, graphics — are collected here automatically.'
              : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {visible.map((g) => (
              <button
                key={g.key}
                onClick={() => setOpenKey(g.key)}
                className="text-left bg-bg-elev border border-border rounded-xl p-3.5 hover:border-accent/40 hover:shadow-elev-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent uppercase text-[9px] tracking-wide">{g.latest.type}</span>
                  {g.versions.length > 1 && (
                    <span className="text-[9px] text-fg-subtle uppercase">{g.versions.length} versions</span>
                  )}
                </div>
                <div className="text-sm font-medium text-fg truncate mb-1" title={artifactLabel(g.latest)}>
                  {artifactLabel(g.latest)}
                </div>
                <div className="text-[11px] text-fg-subtle truncate">
                  {convTitle.get(g.latest.conversationId) || 'Deleted chat'}
                </div>
                <div className="text-[10px] text-fg-subtle mt-1.5">{timeAgo(g.latest.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <ArtifactViewer
          group={open}
          conversationTitle={convTitle.get(open.latest.conversationId)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </main>
  );
}

function ArtifactViewer({ group, conversationTitle, onClose }: { group: Group; conversationTitle?: string; onClose: () => void }): JSX.Element {
  const [vIdx, setVIdx] = useState(group.versions.length - 1);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const active = group.versions[Math.min(vIdx, group.versions.length - 1)];
  const previewHtml = useMemo(() => renderVisionHtml(active), [active.type, active.content]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(active.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  };

  const goToConversation = async (): Promise<void> => {
    await useAppStore.getState().selectConversation(active.conversationId);
    useAppStore.getState().toggleVisionTab(); // back to chat view
    onClose();
  };

  const deleteAll = async (): Promise<void> => {
    if (!window.confirm(`Delete "${artifactLabel(active)}"${group.versions.length > 1 ? ` and all ${group.versions.length} versions` : ''}?`)) return;
    for (const v of group.versions) await window.hive.artifactDelete(v.id);
    useAppStore.getState().notifyArtifactsChanged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-elev border border-border rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Viewer header */}
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent uppercase text-[9px] tracking-wide">{active.type}</span>
          <span className="text-sm font-medium truncate">{artifactLabel(active)}</span>
          {conversationTitle && <span className="text-xs text-fg-subtle truncate">· {conversationTitle}</span>}
          {group.versions.length > 1 && (
            <span className="flex items-center gap-1 text-xs text-fg-muted ml-2">
              <button onClick={() => setVIdx(Math.max(0, vIdx - 1))} disabled={vIdx === 0} className="px-1 rounded hover:bg-bg-input disabled:opacity-30">‹</button>
              v{vIdx + 1}/{group.versions.length}
              <button onClick={() => setVIdx(Math.min(group.versions.length - 1, vIdx + 1))} disabled={vIdx === group.versions.length - 1} className="px-1 rounded hover:bg-bg-input disabled:opacity-30">›</button>
            </span>
          )}
          <div className="flex-1" />
          <div className="flex items-center bg-bg rounded-lg p-0.5 text-[11px]">
            <button onClick={() => setView('preview')} className={`px-2 py-0.5 rounded-md ${view === 'preview' ? 'bg-bg-input text-fg' : 'text-fg-muted hover:text-fg'}`}>Preview</button>
            <button onClick={() => setView('code')} className={`px-2 py-0.5 rounded-md ${view === 'code' ? 'bg-bg-input text-fg' : 'text-fg-muted hover:text-fg'}`}>Code</button>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg px-1.5 text-lg leading-none">×</button>
        </div>

        {/* Content */}
        {view === 'preview' ? (
          active.type === 'markdown' ? (
            <div className="flex-1 overflow-y-auto bg-bg px-6 py-5 text-sm message-content select-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{active.content}</ReactMarkdown>
            </div>
          ) : previewHtml ? (
            <iframe srcDoc={previewHtml} sandbox="allow-scripts allow-forms allow-modals allow-popups" className="flex-1 w-full border-0 bg-white" title={artifactLabel(active)} />
          ) : (
            <pre className="flex-1 p-4 text-xs font-mono text-fg bg-bg overflow-auto select-text"><code>{active.content}</code></pre>
          )
        ) : (
          <pre className="flex-1 p-4 text-xs font-mono text-fg bg-bg overflow-auto select-text whitespace-pre-wrap"><code>{active.content}</code></pre>
        )}

        {/* Actions */}
        <div className="px-3 py-2 border-t border-border flex items-center gap-1">
          <ViewerAction onClick={() => void copy()}>{copied ? '✓ Copied' : 'Copy'}</ViewerAction>
          <ViewerAction onClick={() => void window.hive.visionExport({ title: active.title, type: active.type, language: active.language, content: active.content })}>Download</ViewerAction>
          {previewHtml && (
            <ViewerAction onClick={() => void window.hive.visionOpenExternal({ html: previewHtml, id: active.id })}>Open in browser</ViewerAction>
          )}
          <ViewerAction onClick={() => void goToConversation()}>Open conversation</ViewerAction>
          <div className="flex-1" />
          <ViewerAction danger onClick={() => void deleteAll()}>Delete</ViewerAction>
        </div>
      </div>
    </div>
  );
}

function ViewerAction({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-md transition ${danger ? 'text-danger/80 hover:text-danger hover:bg-danger/10' : 'text-fg-muted hover:text-fg hover:bg-bg-input'}`}
    >
      {children}
    </button>
  );
}

function FilterChip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-md transition ${active ? 'bg-accent text-white' : 'bg-bg-elev text-fg-muted hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
