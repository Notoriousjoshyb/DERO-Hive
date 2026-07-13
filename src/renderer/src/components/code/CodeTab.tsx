import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/app';
import { TokenUsageBar } from '../TokenUsage';
import { InputBar } from '../InputBar';
import { CodeEditor } from './CodeEditor';
import { ExplainOverlay } from './ExplainOverlay';
import { FileTypeIcon } from './fileIcons';

interface OpenFile {
  path: string;
  name: string;
  content: string;
  modified: boolean;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'out', 'release',
  '.cache', '__pycache__', 'target', 'build', '.venv', 'venv', '.idea',
  '.vscode', 'coverage', '.turbo', '.svelte-kit'
]);

export function CodeTab(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const conversations = useAppStore((s) => s.conversations);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const currentMessages = useAppStore((s) => s.currentMessages);
  const projects = useAppStore((s) => s.projects);
  const fileChanges = useAppStore((s) => s.fileChanges);

  // An explicitly opened folder (VSCode-style "Open Folder") overrides the
  // project/working-directory root for the explorer. Persisted to settings so
  // it survives across sessions.
  const [rootOverride, setRootOverride] = useState<string | null>(null);
  const [explainTarget, setExplainTarget] = useState<{ code: string; path: string; language: string } | null>(null);

  const projectPath = useMemo(() => {
    if (rootOverride) return rootOverride;
    if (settings.codeFolder) return settings.codeFolder;
    const current = conversations.find((c) => c.id === currentConversationId);
    if (current?.projectId) {
      const project = projects.find((p) => p.id === current.projectId);
      if (project?.path) return project.path;
    }
    return settings.workingDirectory;
  }, [rootOverride, settings.codeFolder, conversations, currentConversationId, projects, settings.workingDirectory]);

  // Aggregate this session's file edits by path for git-style +/- indicators.
  const changesByPath = useMemo(() => {
    const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    const map = new Map<string, { added: number; removed: number; isNew: boolean }>();
    for (const c of fileChanges) {
      const key = norm(c.path);
      const cur = map.get(key) || { added: 0, removed: 0, isNew: false };
      map.set(key, {
        added: cur.added + (c.linesAdded || 0),
        removed: cur.removed + (c.linesRemoved || 0),
        isNew: cur.isNew || !!c.isNewFile
      });
    }
    return map;
  }, [fileChanges]);

  const changeFor = useCallback((fullPath: string): { added: number; removed: number; isNew: boolean } | undefined => {
    const f = fullPath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    for (const [k, v] of changesByPath) {
      if (k === f || f.endsWith('/' + k) || k.endsWith('/' + f)) return v;
    }
    return undefined;
  }, [changesByPath]);

  const sessionChangeSummary = useMemo(() => {
    let added = 0, removed = 0;
    for (const v of changesByPath.values()) { added += v.added; removed += v.removed; }
    return { files: changesByPath.size, added, removed };
  }, [changesByPath]);

  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<Array<{ kind: 'cmd' | 'out' | 'err'; text: string }>>([]);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState<string>(projectPath || '');
  // Terminal is collapsed by default; opened via the button above the composer.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);

  const openFolder = useCallback(async (): Promise<void> => {
    const dir = await window.hive.fsPickDirectory();
    if (dir) {
      setRootOverride(dir);
      setCwd(dir);
      void updateSettings({ codeFolder: dir }); // persist across sessions
    }
  }, [updateSettings]);

  // File explorer state
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map());
  const [treeLoading, setTreeLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const terminalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Tear down the persistent shell when the Code tab unmounts.
  useEffect(() => () => { void window.hive.terminalDispose(sessionIdRef.current); }, []);

  // Keep cwd in sync when the project changes (only if user hasn't navigated away)
  useEffect(() => {
    if (projectPath) setCwd((prev) => prev || projectPath);
  }, [projectPath]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // ————— File explorer loading —————
  const sortEntries = (entries: FileEntry[]): FileEntry[] =>
    entries
      .filter((e) => !SKIP_DIRS.has(e.name))
      .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)));

  useEffect(() => {
    if (!projectPath) { setRootEntries([]); return; }
    let cancelled = false;
    setTreeLoading(true);
    window.hive.fsList(projectPath)
      .then((entries: FileEntry[]) => { if (!cancelled) { setRootEntries(sortEntries(entries)); setExpanded(new Set()); setChildrenMap(new Map()); } })
      .catch(() => { if (!cancelled) setRootEntries([]); })
      .finally(() => { if (!cancelled) setTreeLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath, refreshKey]);

  const loadChildren = useCallback(async (path: string): Promise<void> => {
    try {
      const entries = await window.hive.fsList(path);
      setChildrenMap((prev) => new Map(prev).set(path, sortEntries(entries)));
    } catch {
      setChildrenMap((prev) => new Map(prev).set(path, []));
    }
  }, []);

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else { next.add(path); if (!childrenMap.has(path)) void loadChildren(path); }
      return next;
    });
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newHeight = rect.bottom - e.clientY;
      setTerminalHeight(Math.max(80, Math.min(rect.height - 100, newHeight)));
    };
    const handleMouseUp = (): void => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  function getLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c',
      cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
      kt: 'kotlin', scala: 'scala', md: 'markdown', json: 'json', yaml: 'yaml',
      yml: 'yaml', xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
      sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell'
    };
    return map[ext || ''] || 'plaintext';
  }

  async function openFile(path?: string): Promise<void> {
    let filePath: string | undefined = path;
    if (!filePath) {
      filePath = await window.hive.fsPickFile([
        { name: 'All Files', extensions: ['*'] },
        { name: 'Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h'] },
        { name: 'Text', extensions: ['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'html', 'css'] }
      ]) ?? undefined;
    }
    if (!filePath) return;

    const existing = files.find((f) => f.path === filePath);
    if (existing) { setActiveFile(filePath); return; }

    try {
      const result = await window.hive.fsRead(filePath, { encoding: 'utf-8' });
      const name = filePath.split(/[/\\]/).pop() || filePath;
      setFiles((prev) => [...prev, { path: filePath!, name, content: result.content, modified: false }]);
      setActiveFile(filePath);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }

  async function saveFile(): Promise<void> {
    if (!activeFile) return;
    const file = files.find((f) => f.path === activeFile);
    if (!file) return;
    try {
      const content = textareaRef.current?.value || file.content;
      await window.hive.fsWrite(file.path, content);
      setFiles((prev) => prev.map((f) => (f.path === activeFile ? { ...f, content, modified: false } : f)));
    } catch (e) {
      console.error('Failed to save file:', e);
    }
  }

  async function runTerminalCommand(): Promise<void> {
    const cmd = terminalInput.trim();
    if (!cmd) return;
    const runCwd = cwd || projectPath || undefined;
    setTerminalOutput((prev) => [...prev, { kind: 'cmd', text: `${shortenPath(cwd)} ❯ ${cmd}` }]);
    setTerminalHistory((prev) => [...prev, cmd]);
    setHistoryIndex(-1);
    setTerminalInput('');

    // Built-in: clear (everything else — cd, pwd, etc. — runs in the real shell)
    if (cmd === 'clear' || cmd === 'cls') { setTerminalOutput([]); return; }

    setRunning(true);
    try {
      const result = await window.hive.terminalExec(sessionIdRef.current, cmd, runCwd);
      if (result.stdout) setTerminalOutput((prev) => [...prev, { kind: 'out', text: result.stdout }]);
      if (result.stderr) setTerminalOutput((prev) => [...prev, { kind: 'err', text: result.stderr }]);
      // The shell owns the working directory (native cd); sync our prompt to it.
      if (result.cwd && result.cwd !== cwd) setCwd(result.cwd);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, { kind: 'err', text: String(e) }]);
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      void runTerminalCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (terminalHistory.length > 0) {
        const newIndex = historyIndex < terminalHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setTerminalInput(terminalHistory[terminalHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setTerminalInput(terminalHistory[terminalHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setTerminalInput('');
      }
    }
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveFile();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      setFiles((prev) => prev.map((f) => (f.path === activeFile ? { ...f, content: newValue, modified: true } : f)));
    }
  }

  function closeFile(path: string): void {
    setFiles((prev) => prev.filter((f) => f.path !== path));
    if (activeFile === path) {
      const remaining = files.filter((f) => f.path !== path);
      setActiveFile(remaining.length > 0 ? remaining[0].path : null);
    }
  }

  function updateFileContent(content: string): void {
    if (!activeFile) return;
    setFiles((prev) => prev.map((f) => (f.path === activeFile ? { ...f, content, modified: true } : f)));
  }

  const activeFileObj = files.find((f) => f.path === activeFile);
  const themeClass = `code-theme-${settings.codeTheme || 'vscode'}`;

  useEffect(() => {
    if (terminalOpen) {
      const t = setTimeout(() => terminalInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [terminalOpen]);

  return (
    <div className="flex flex-col h-full bg-bg flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1 bg-bg-elev border-b border-border">
        <button
          onClick={() => setExplorerOpen((v) => !v)}
          className={`p-1 rounded transition ${explorerOpen ? 'text-fg bg-bg-input' : 'text-fg-subtle hover:text-fg hover:bg-bg-input'}`}
          title="Toggle file explorer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M1.5 3.5h4L7 5h5.5v6h-11z" />
          </svg>
        </button>
        <div className="flex-1" />
        <div className="hidden sm:block"><TokenUsageBar /></div>
        <button
          onClick={() => void openFolder()}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-fg-muted hover:text-fg hover:bg-bg-input rounded-md transition"
          title="Open a folder in the explorer"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M1.5 3.5h4L7 5h5.5v6h-11z" />
          </svg>
          Open Folder
        </button>
        <button onClick={() => void openFile()} className="px-2 py-1 text-xs text-fg-muted hover:text-fg hover:bg-bg-input rounded-md transition">
          Open File…
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className={`p-1 rounded transition ${chatOpen ? 'text-accent bg-accent-soft' : 'text-fg-subtle hover:text-fg hover:bg-bg-input'}`}
          title="Toggle assistant chat"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M12 7.5a4.5 4.5 0 01-6.3 4.1L2 12.5l1-3.2A4.5 4.5 0 1112 7.5z" />
          </svg>
        </button>
        {activeFileObj && (
          <button
            onClick={() => void saveFile()}
            className={`px-2 py-1 text-xs rounded-md transition ${activeFileObj.modified ? 'text-accent hover:bg-accent-soft' : 'text-fg-subtle cursor-not-allowed'}`}
            disabled={!activeFileObj.modified}
          >
            Save
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* File explorer */}
        {explorerOpen && (
          <div className="w-56 flex-shrink-0 border-r border-border bg-bg-sidebar/40 flex flex-col">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle truncate flex-1" title={projectPath}>
                {projectPath ? (projectPath.split(/[/\\]/).filter(Boolean).pop() || projectPath) : 'Explorer'}
              </span>
              <button
                onClick={() => void openFolder()}
                className="p-0.5 rounded hover:bg-bg-elev text-fg-subtle hover:text-fg"
                title="Open folder…"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                  <path d="M1.5 3.5h4L7 5h5.5v6h-11z" />
                  <path d="M7 7.5v3M5.5 9h3" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="p-0.5 rounded hover:bg-bg-elev text-fg-subtle hover:text-fg"
                title="Refresh"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className={treeLoading ? 'animate-spin' : ''}>
                  <path d="M2 7a5 5 0 018.5-3.5L12 5M12 7a5 5 0 01-8.5 3.5L2 9" strokeLinecap="round" />
                  <path d="M10 2v3h3M4 12V9H1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1 font-mono text-xs">
              {!projectPath ? (
                <div className="px-3 py-8 text-center flex flex-col items-center gap-3">
                  <p className="text-fg-subtle text-[11px] leading-relaxed">No folder open.</p>
                  <button
                    onClick={() => void openFolder()}
                    className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-[11px] font-medium shadow-elev-sm transition"
                  >
                    Open Folder
                  </button>
                </div>
              ) : rootEntries.length === 0 && !treeLoading ? (
                <div className="px-3 py-4 text-center text-fg-subtle text-[10px]">Empty directory</div>
              ) : (
                rootEntries.map((entry) => (
                  <TreeRow
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    expanded={expanded}
                    childrenMap={childrenMap}
                    activePath={activeFile}
                    onToggle={toggleDir}
                    onOpenFile={(p) => void openFile(p)}
                    changeFor={changeFor}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Editor + terminal */}
        <div className="flex-1 min-w-0 flex flex-col">
          {files.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-bg border-b border-border overflow-x-auto">
              {files.map((f) => (
                <div
                  key={f.path}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md cursor-pointer transition ${f.path === activeFile ? 'bg-bg-elev text-fg' : 'text-fg-muted hover:bg-bg-elev'}`}
                  onClick={() => setActiveFile(f.path)}
                >
                  <FileTypeIcon name={f.name} size={12} />
                  <span>{f.name}</span>
                  {f.modified && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); closeFile(f.path); }}
                    className="ml-1 w-4 h-4 flex items-center justify-center rounded text-fg-subtle hover:text-fg hover:bg-bg-input"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
            {/* Editor (always visible) — dark VSCode-like surface */}
            <div className={`flex-1 min-h-0 flex flex-col editor-surface ${themeClass}`}>
              {activeFileObj ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="editor-chrome px-3 py-1 border-b text-[11px] flex items-center gap-2 flex-shrink-0">
                    <FileTypeIcon name={activeFileObj.name} size={13} />
                    <span className="text-[#d4d4d4]">{activeFileObj.name}</span>
                    <span className="opacity-70">{getLanguage(activeFileObj.name)}</span>
                    {activeFileObj.modified && <span className="text-[#e2c08d]">● unsaved</span>}
                    {activeFileObj && (
                      <button
                        onClick={() => {
                          const ta = textareaRef?.current;
                          const sel = ta?.value.substring(ta.selectionStart, ta.selectionEnd);
                          const code = sel || activeFileObj.content.split('\n').slice(0, 10).join('\n');
                          setExplainTarget({ code, path: activeFileObj.path, language: getLanguage(activeFileObj.name) });
                        }}
                        className="ml-auto text-[10px] text-[#6a6a6a] hover:text-[#d4d4d4] px-2 py-0.5 rounded border border-[#3f3f3f] hover:border-[#5f5f5f] transition"
                      >Explain</button>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <CodeEditor
                      value={activeFileObj.content}
                      onChange={updateFileContent}
                      onKeyDown={handleEditorKeyDown}
                      language={getLanguage(activeFileObj.name)}
                      themeClass={themeClass}
                      textareaRef={textareaRef}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-sm gap-3" style={{ color: '#6a6a6a' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ color: '#3f3f3f' }}>
                    <path d="M6 2h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" strokeLinejoin="round" />
                    <path d="M14 2v6h6" strokeLinejoin="round" />
                  </svg>
                  <div className="text-center">
                    <div>No file open</div>
                    <div className="text-xs mt-1" style={{ color: '#5a5a5a' }}>Pick a file from the explorer or click “Open File”.</div>
                  </div>
                </div>
              )}
            </div>

            {/* Terminal — sits under the editor, toggled from the bar above the composer */}
            {terminalOpen && (
              <>
                <div
                  onMouseDown={() => setIsResizing(true)}
                  className="h-1 cursor-row-resize flex-shrink-0 group relative"
                  style={{ background: '#333333' }}
                  title="Drag to resize terminal"
                >
                  <div className="absolute inset-x-0 -top-1 -bottom-1" />
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 bg-fg-subtle group-hover:bg-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div style={{ height: `${terminalHeight}px` }} className="flex flex-col flex-shrink-0">
                  <div className="terminal-chrome px-2 py-1 border-b text-xs font-mono flex items-center justify-between flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3l3 2-3 2M5 7h3" /></svg>
                      Terminal
                      <span className="opacity-60 not-italic">· {navigator.platform.startsWith('Win') ? 'PowerShell' : 'sh'}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {running && <span className="text-[10px] text-warn inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />running</span>}
                      <span className="text-[10px] opacity-70 truncate max-w-[240px]" title={cwd}>{shortenPath(cwd)}</span>
                      <button onClick={() => setTerminalOutput([])} className="text-[10px] opacity-70 hover:opacity-100" title="Clear output">clear</button>
                      <button onClick={() => setTerminalOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" title="Hide terminal">✕</button>
                    </div>
                  </div>
                  <div
                    className="flex-1 overflow-y-auto font-mono text-xs p-2 terminal-surface cursor-text leading-relaxed"
                    ref={terminalRef}
                    onClick={() => terminalInputRef.current?.focus()}
                  >
                    {terminalOutput.length === 0 ? (
                      <div className="select-none" style={{ color: '#6a6a6a' }}>Persistent {navigator.platform.startsWith('Win') ? 'PowerShell' : 'shell'} session — {'cd'} persists between commands. <span style={{ color: '#4a4a4a' }}>Type "clear" to reset.</span></div>
                    ) : (
                      terminalOutput.map((line, i) => (
                        <div
                          key={i}
                          className={`whitespace-pre-wrap ${line.kind === 'cmd' ? 'term-cmd' : line.kind === 'err' ? 'term-err' : 'term-out'}`}
                        >
                          {line.text}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="terminal-input-row flex items-center gap-2 px-2 py-1.5 border-t focus-within:border-accent">
                    <span className="term-cmd font-mono text-xs select-none flex-shrink-0">{shortenPath(cwd)}{' '}❯</span>
                    <input
                      ref={terminalInputRef}
                      type="text"
                      value={terminalInput}
                      onChange={(e) => setTerminalInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="flex-1 bg-transparent text-[#d4d4d4] text-xs outline-none font-mono caret-accent placeholder:text-[#6a6a6a]"
                      placeholder="Run a command…"
                    />
                    {terminalInput && (
                      <button onClick={() => setTerminalInput('')} className="text-[#8a8a8a] hover:text-[#d4d4d4] text-xs px-1" title="Clear input">×</button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Terminal toggle bar — sits directly above the composer */}
      <div className="flex items-center gap-2 px-2 py-1 bg-bg-elev border-t border-border flex-shrink-0">
        <button
          onClick={() => setTerminalOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
            terminalOpen ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:text-fg hover:bg-bg-input'
          }`}
          title={terminalOpen ? 'Hide terminal' : 'Open terminal'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1.5" width="10" height="9" rx="1.5" />
            <path d="M3 4.5l1.5 1.5L3 7.5M6 7.5h3" />
          </svg>
          Terminal
        </button>
        <span className="text-[10px] text-fg-subtle font-mono truncate" title={cwd}>{shortenPath(cwd)}</span>
        <div className="flex-1" />
        {sessionChangeSummary.files > 0 && (
          <span className="text-[10px] font-mono tabular-nums inline-flex items-center gap-1.5" title={`${sessionChangeSummary.files} file(s) changed this session`}>
            <span className="text-fg-subtle">{sessionChangeSummary.files} changed</span>
            <span className="text-success">+{sessionChangeSummary.added}</span>
            <span className="text-danger">−{sessionChangeSummary.removed}</span>
          </span>
        )}
      </div>

      {/* Assistant composer — just the chat box; responses appear in the main chat */}
      {chatOpen && (
        <div className="flex-shrink-0">
          <InputBar conversationId={currentConversationId} hasMessages={currentMessages.length > 0} />
        </div>
      )}

      {explainTarget && (
        <ExplainOverlay
          code={explainTarget.code}
          path={explainTarget.path}
          language={explainTarget.language}
          onClose={() => setExplainTarget(null)}
        />
      )}
    </div>
  );
}

function shortenPath(p: string): string {
  if (!p) return '~';
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return '…' + (p.includes('\\') ? '\\' : '/') + parts.slice(-2).join(p.includes('\\') ? '\\' : '/');
}

function TreeRow({
  entry,
  depth,
  expanded,
  childrenMap,
  activePath,
  onToggle,
  onOpenFile,
  changeFor
}: {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  childrenMap: Map<string, FileEntry[]>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  changeFor: (path: string) => { added: number; removed: number; isNew: boolean } | undefined;
}): JSX.Element {
  const isOpen = expanded.has(entry.path);
  const kids = childrenMap.get(entry.path);
  const indent = 8 + depth * 12;

  if (entry.isDirectory) {
    return (
      <>
        <div
          className="flex items-center gap-1 px-2 py-0.5 hover:bg-bg-elev cursor-pointer"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => onToggle(entry.path)}
        >
          <svg className={`text-fg-subtle transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`} width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <path d="M3 1l4 4-4 4z" />
          </svg>
          <FolderIcon open={isOpen} />
          <span className="text-fg-muted truncate flex-1">{entry.name}</span>
        </div>
        {isOpen && kids && kids.map((k) => (
          <TreeRow key={k.path} entry={k} depth={depth + 1} expanded={expanded} childrenMap={childrenMap} activePath={activePath} onToggle={onToggle} onOpenFile={onOpenFile} changeFor={changeFor} />
        ))}
      </>
    );
  }

  const active = activePath === entry.path;
  const change = changeFor(entry.path);
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer ${
        active ? 'bg-accent-soft text-accent' : change ? 'hover:bg-bg-elev text-[#e2c08d]' : 'hover:bg-bg-elev text-fg-muted'
      }`}
      style={{ paddingLeft: `${indent + 12}px` }}
      onClick={() => onOpenFile(entry.path)}
      title={change ? `${change.isNew ? 'Added' : 'Modified'} — +${change.added} / −${change.removed} lines this session` : undefined}
    >
      <FileTypeIcon name={entry.name} size={13} />
      <span className="truncate flex-1">{entry.name}</span>
      {change && (
        <span className="flex items-center gap-1 text-[9px] font-mono tabular-nums flex-shrink-0">
          {change.added > 0 && <span className="text-success">+{change.added}</span>}
          {change.removed > 0 && <span className="text-danger">−{change.removed}</span>}
          {change.isNew && change.added === 0 && change.removed === 0 && <span className="text-success">new</span>}
        </span>
      )}
    </div>
  );
}

function FolderIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" className="text-fg-subtle flex-shrink-0">
      {open
        ? <path d="M1.5 4h3.5L6.5 5.5H12l-1 5.5H2z" />
        : <path d="M1.5 3.5h4L7 5h5.5v6h-11z" />}
    </svg>
  );
}

