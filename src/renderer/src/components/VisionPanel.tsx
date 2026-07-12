import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '../stores/app';
import type { Artifact } from '@shared/types';
import { extractArtifacts, artifactGroupKey, artifactLabel as label, type ExtractedArtifact } from '../lib/artifacts';
import { renderVisionHtml } from '../lib/visionRender';
import { MediaStudio } from './MediaStudio';

const MIN_PANEL_WIDTH = 280;
const MIN_CHAT_WIDTH = 360;
const LEFT_SIDEBAR_WIDTH = 256;
const RIGHT_SIDEBAR_WIDTH = 288;

export function VisionPanel(): JSX.Element {
  const currentId = useAppStore((s) => s.currentConversationId);
  const artifactsChangedAt = useAppStore((s) => s.artifactsChangedAt);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamingContent = useAppStore((s) => s.streamingContent);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);

  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [versionIdx, setVersionIdx] = useState<number | null>(null);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<ExtractedArtifact | null>(null);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const prevNewestAt = useRef(0);

  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('visionPanelWidth'));
    return saved >= MIN_PANEL_WIDTH ? saved : 620;
  });
  const [resizing, setResizing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const panelRef = useRef<HTMLElement>(null);
  const sidebarsWidth = (sidebarOpen ? LEFT_SIDEBAR_WIDTH : 0) + (rightSidebarOpen ? RIGHT_SIDEBAR_WIDTH : 0);
  const maxDockedWidth = viewportWidth - sidebarsWidth - MIN_CHAT_WIDTH;
  const docked = maxDockedWidth >= MIN_PANEL_WIDTH;
  const renderedWidth = docked
    ? Math.min(width, Math.min(980, maxDockedWidth))
    : Math.min(width, Math.max(MIN_PANEL_WIDTH, viewportWidth - 24));

  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent): void => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const max = docked
        ? Math.min(980, maxDockedWidth)
        : Math.min(980, window.innerWidth - 24);
      setWidth(Math.round(Math.min(max, Math.max(MIN_PANEL_WIDTH, rect.right - e.clientX))));
    };
    const onUp = (): void => setResizing(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      localStorage.setItem('visionPanelWidth', String(panelRef.current?.getBoundingClientRect().width ?? 620));
    };
  }, [resizing, docked, maxDockedWidth]);

  useEffect(() => {
    if (!currentId) { setArtifacts([]); setActiveGroup(null); return; }
    let cancelled = false;
    void window.hive.artifactList(currentId).then((rows) => {
      if (cancelled) return;
      setArtifacts(rows);
      const newest = rows[0];
      if (newest && newest.createdAt > prevNewestAt.current) {
        prevNewestAt.current = newest.createdAt;
        setActiveGroup(artifactGroupKey(newest));
        setVersionIdx(null);
        setDraft(null);
      }
    });
    return () => { cancelled = true; };
  }, [currentId, artifactsChangedAt]);

  useEffect(() => {
    if (!isStreaming) { setLive(null); return; }
    const t = setTimeout(() => {
      const found = extractArtifacts(streamingContent);
      setLive(found.length > 0 ? found[found.length - 1] : null);
    }, 600);
    return () => clearTimeout(t);
  }, [streamingContent, isStreaming]);

  useEffect(() => {
    return window.hive.onMediaStatus(({ job }) => {
      if (job.status === 'queued' || job.status === 'running') {
        setMediaExpanded(true);
      }
    });
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of [...artifacts].reverse()) {
      const key = artifactGroupKey(a);
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort((x, y) =>
      y[1][y[1].length - 1].createdAt - x[1][x[1].length - 1].createdAt
    );
  }, [artifacts]);

  const activeVersions = groups.find(([k]) => k === activeGroup)?.[1]
    ?? groups[0]?.[1]
    ?? [];
  const vIdx = versionIdx === null
    ? activeVersions.length - 1
    : Math.min(versionIdx, activeVersions.length - 1);
  const active: Artifact | undefined = activeVersions[vIdx];

  const shown: { type: Artifact['type']; content: string; title?: string; language?: string } | undefined =
    (isStreaming && live) ? live : active;

  const previewHtml = useMemo(
    () => shown ? renderVisionHtml(shown) : null,
    [shown?.type, shown?.content]
  );

  const copy = async (): Promise<void> => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(draft ?? shown.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  };

  const download = async (): Promise<void> => {
    if (!shown) return;
    await window.hive.visionExport({
      title: shown.title,
      type: shown.type,
      language: shown.language,
      content: draft ?? shown.content
    });
  };

  const openInBrowser = async (): Promise<void> => {
    if (!shown) return;
    const html = renderVisionHtml(shown);
    if (!html) return;
    await window.hive.visionOpenExternal({ html, id: active?.id || 'live' });
  };

  const applyEdit = async (): Promise<void> => {
    if (!active || draft === null || draft === active.content) { setDraft(null); return; }
    const r = await window.hive.artifactUpdate({ sourceId: active.id, content: draft });
    if (r.ok) {
      setDraft(null);
      setVersionIdx(null);
      useAppStore.getState().notifyArtifactsChanged();
    }
  };

  const deleteVersion = async (): Promise<void> => {
    if (!active) return;
    if (!window.confirm(`Delete ${activeVersions.length > 1 ? `version ${vIdx + 1} of ` : ''}"${label(active)}"?`)) return;
    await window.hive.artifactDelete(active.id);
    setVersionIdx(null);
    setDraft(null);
    useAppStore.getState().notifyArtifactsChanged();
  };

  const selectGroup = (key: string): void => {
    setActiveGroup(key);
    setVersionIdx(null);
    setDraft(null);
    setView('preview');
  };

  return (
    <aside
      ref={panelRef}
      data-vision-panel
      style={{ width: renderedWidth }}
      className={`${docked ? 'flex-shrink-0 relative z-10' : 'absolute inset-y-0 right-0 z-30 shadow-2xl'} bg-bg-sidebar border-l border-border flex flex-col h-full`}
    >
      <div
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        title="Drag to resize"
        className={`absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize z-20 transition-colors ${resizing ? 'bg-accent/60' : 'hover:bg-accent/40'}`}
      />
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
        <VisionIcon />
        <span className="text-sm font-semibold">Vision</span>
        {isStreaming && live && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> live
          </span>
        )}
        <div className="flex-1" />
        {shown && (
          <div className="flex items-center bg-bg-elev rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setView('preview')}
              className={`px-2 py-0.5 rounded-md transition ${view === 'preview' ? 'bg-bg text-fg shadow-elev-sm' : 'text-fg-muted hover:text-fg'}`}
            >Preview</button>
            <button
              onClick={() => setView('code')}
              className={`px-2 py-0.5 rounded-md transition ${view === 'code' ? 'bg-bg text-fg shadow-elev-sm' : 'text-fg-muted hover:text-fg'}`}
            >Code</button>
          </div>
        )}
        <button onClick={() => useAppStore.getState().toggleVision()} title="Close Vision" className="text-fg-muted hover:text-fg px-1">×</button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Artifacts section */}
        {shown ? (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-2 text-xs flex-shrink-0">
              <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent uppercase text-[9px] tracking-wide flex-shrink-0">{shown.type}</span>
              <span className="truncate text-fg font-medium flex-1" title={label(shown)}>{label(shown)}</span>
              {!live && activeVersions.length > 1 && (
                <span className="flex items-center gap-1 text-fg-muted flex-shrink-0">
                  <button
                    onClick={() => { setVersionIdx(Math.max(0, vIdx - 1)); setDraft(null); }}
                    disabled={vIdx === 0}
                    className="px-1 rounded hover:bg-bg-elev disabled:opacity-30"
                  >‹</button>
                  v{vIdx + 1}/{activeVersions.length}
                  <button
                    onClick={() => { setVersionIdx(Math.min(activeVersions.length - 1, vIdx + 1)); setDraft(null); }}
                    disabled={vIdx === activeVersions.length - 1}
                    className="px-1 rounded hover:bg-bg-elev disabled:opacity-30"
                  >›</button>
                </span>
              )}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {view === 'preview' ? (
                shown.type === 'markdown' ? (
                  <div className="flex-1 overflow-y-auto bg-bg px-5 py-4 text-sm message-content select-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {shown.content}
                    </ReactMarkdown>
                  </div>
                ) : previewHtml ? (
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    className={`flex-1 w-full border-0 bg-white ${resizing ? 'pointer-events-none' : ''}`}
                    title={label(shown)}
                  />
                ) : (
                  <pre className="flex-1 p-4 text-xs font-mono text-fg bg-bg overflow-auto select-text"><code>{shown.content}</code></pre>
                )
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <textarea
                    value={draft ?? shown.content}
                    onChange={(e) => setDraft(e.target.value)}
                    readOnly={!!live}
                    spellCheck={false}
                    className="flex-1 w-full resize-none bg-bg text-fg font-mono text-xs p-3 focus:outline-none leading-relaxed"
                  />
                  {draft !== null && draft !== active?.content && !live && (
                    <div className="px-3 py-2 border-t border-border flex items-center justify-end gap-2 bg-bg-elev">
                      <span className="text-[10px] text-fg-muted mr-auto">Edits save as a new version</span>
                      <button onClick={() => setDraft(null)} className="text-xs px-2.5 py-1 rounded border border-border text-fg-muted hover:text-fg">Discard</button>
                      <button onClick={() => void applyEdit()} className="text-xs px-2.5 py-1 rounded bg-accent text-white hover:opacity-90">Apply</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-2 py-1.5 border-t border-border flex items-center gap-1 flex-shrink-0">
              <ActionButton onClick={() => void copy()} title="Copy source">{copied ? '✓ Copied' : 'Copy'}</ActionButton>
              <ActionButton onClick={() => void download()} title="Save to a file">Download</ActionButton>
              {previewHtml && shown.type !== 'markdown' && (
                <ActionButton onClick={() => void openInBrowser()} title="Open in your default browser to use or share">Open in browser</ActionButton>
              )}
              {shown.type === 'markdown' && (
                <ActionButton onClick={() => void openInBrowser()} title="Open the rendered document in your browser">Open in browser</ActionButton>
              )}
              <div className="flex-1" />
              {!live && active && (
                <ActionButton onClick={() => void deleteVersion()} title="Delete this version" danger>Delete</ActionButton>
              )}
            </div>

            {groups.length > 1 && (
              <div className="border-t border-border overflow-x-auto p-1.5 flex gap-1 flex-shrink-0">
                {groups.map(([key, versions]) => {
                  const latest = versions[versions.length - 1];
                  const isActive = key === (activeGroup ?? groups[0]?.[0]);
                  return (
                    <button
                      key={key}
                      onClick={() => selectGroup(key)}
                      title={label(latest)}
                      className={`flex-shrink-0 max-w-40 truncate px-2 py-1 rounded-md text-[10px] ${isActive ? 'bg-accent text-white' : 'bg-bg-elev text-fg-muted hover:text-fg'}`}
                    >
                      {label(latest)}{versions.length > 1 ? ` · ${versions.length}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-10 gap-3 min-h-0">
            <VisionIcon size={28} className="text-fg-subtle" />
            <div className="text-sm font-medium text-fg">Your workspace is empty</div>
            <p className="text-xs text-fg-muted leading-relaxed">
              Ask for a web page, React component, SVG, diagram, or document and it
              will open here as a live, editable artifact — with version history,
              export, and browser sharing.
            </p>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border flex-shrink-0" />

        {/* Media section — collapsed by default, expands on click or auto-expands when generating */}
        {mediaExpanded ? (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-1 border-b border-border/60 flex items-center gap-2 flex-shrink-0 bg-bg-elev">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Media</span>
              <div className="flex-1" />
              <button
                onClick={() => setMediaExpanded(false)}
                className="text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg"
                title="Collapse media panel"
              >
                Hide
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <MediaStudio variant="panel" />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setMediaExpanded(true)}
            className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 text-[10px] text-fg-subtle hover:text-fg hover:bg-bg-elev transition font-medium uppercase tracking-wider"
            title="Show media panel"
          >
            <span>Media</span>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 4.5L6 7.5l3-3" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}

function ActionButton({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`text-[11px] px-2 py-1 rounded-md transition ${danger ? 'text-danger/80 hover:text-danger hover:bg-danger/10' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
    >
      {children}
    </button>
  );
}

export function VisionIcon({ size = 15, className = 'text-accent' }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}
