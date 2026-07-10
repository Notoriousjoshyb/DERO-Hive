import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/app';

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
  '.vscode', '.DS_Store', 'coverage', '.turbo', '.svelte-kit'
]);

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}k`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}G`;
}

export function FilesPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const conversations = useAppStore((s) => s.conversations);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const projects = useAppStore((s) => s.projects);

  const projectPath = useMemo(() => {
    const current = conversations.find((c) => c.id === currentConversationId);
    if (current?.projectId) {
      const project = projects.find((p) => p.id === current.projectId);
      if (project?.path) return project.path;
    }
    return settings.workingDirectory;
  }, [conversations, currentConversationId, projects, settings.workingDirectory]);

  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!projectPath) {
      setRootEntries([]);
      return;
    }
    void loadRoot();
  }, [projectPath, refreshKey]);

  async function loadRoot(): Promise<void> {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await window.hive.fsList(projectPath);
      setRootEntries(filterAndSort(entries));
      setExpanded(new Set());
      setChildren(new Map());
    } catch {
      setError('Failed to load files');
      setRootEntries([]);
    } finally {
      setLoading(false);
    }
  }

  const loadChildren = useCallback(async (path: string): Promise<void> => {
    try {
      const entries = await window.hive.fsList(path);
      setChildren((prev) => {
        const next = new Map(prev);
        next.set(path, filterAndSort(entries));
        return next;
      });
    } catch {
      setChildren((prev) => {
        const next = new Map(prev);
        next.set(path, []);
        return next;
      });
    }
  }, []);

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!children.has(path)) {
          void loadChildren(path);
        }
      }
      return next;
    });
  }

  const filteredRoot = useMemo(() => {
    if (!filter.trim()) return rootEntries;
    const f = filter.toLowerCase();
    return rootEntries.filter((e) => e.name.toLowerCase().includes(f));
  }, [rootEntries, filter]);

  if (!projectPath) {
    return (
      <div className="p-4 text-center text-fg-subtle text-xs">
        <div className="text-2xl mb-2">📁</div>
        <p>No project folder set</p>
        <p className="text-[10px] mt-1">Add a project in the sidebar to browse its files</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-2 py-1.5 border-b border-border flex items-center gap-1">
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <span className="text-fg-subtle flex-shrink-0">📁</span>
          <span className="text-fg truncate font-medium" title={projectPath}>
            {projectPath.split(/[/\\]/).filter(Boolean).pop() || projectPath}
          </span>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="p-1 rounded hover:bg-bg-elev text-fg-subtle hover:text-fg flex-shrink-0"
          title="Refresh"
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      <div className="px-2 py-1 border-b border-border">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full px-2 py-0.5 text-[11px] bg-bg-input border border-border rounded text-fg placeholder-fg-subtle focus:border-accent focus:outline-none"
        />
      </div>

      {error ? (
        <div className="p-3 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="flex-1 overflow-y-auto font-mono py-1">
          {filteredRoot.length === 0 && !loading && (
            <div className="px-3 py-4 text-center text-fg-subtle text-[10px]">
              {filter ? 'No matches' : 'Empty directory'}
            </div>
          )}
          {filteredRoot.map((entry) => (
            <TreeRow
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              children={children}
              onToggle={toggleDir}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function filterAndSort(entries: FileEntry[]): FileEntry[] {
  return entries
    .filter((e) => !SKIP_DIRS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function TreeRow({
  entry,
  depth,
  expanded,
  children,
  onToggle
}: {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  children: Map<string, FileEntry[]>;
  onToggle: (path: string) => void;
}): JSX.Element {
  const isOpen = expanded.has(entry.path);
  const kids = children.get(entry.path);
  const indent = depth * 3;

  if (entry.isDirectory) {
    return (
      <>
        <div
          className="flex items-center gap-1 px-2 py-0.5 hover:bg-bg-elev rounded cursor-pointer"
          style={{ paddingLeft: `${8 + indent * 4}px` }}
          onClick={() => onToggle(entry.path)}
        >
          <svg
            className={`text-fg-subtle transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}
            width="9" height="9" viewBox="0 0 10 10" fill="currentColor"
          >
            <path d="M3 1l4 4-4 4" />
          </svg>
          <span className="flex-shrink-0">{isOpen ? '📂' : '📁'}</span>
          <span className="text-fg truncate flex-1">{entry.name}</span>
        </div>
        {isOpen && kids && kids.length > 0 && (
          <div>
            {kids.map((k) => (
              <TreeRow
                key={k.path}
                entry={k}
                depth={depth + 1}
                expanded={expanded}
                children={children}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
        {isOpen && kids && kids.length === 0 && (
          <div
            className="text-fg-subtle italic text-[10px]"
            style={{ paddingLeft: `${8 + (depth + 1) * 12 + 12}px` }}
          >
            (empty)
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 hover:bg-bg-elev rounded group"
      style={{ paddingLeft: `${8 + indent * 4 + 12}px` }}
    >
      <FileIcon name={entry.name} />
      <span className="text-fg-muted truncate flex-1">{entry.name}</span>
      {entry.size !== undefined && (
        <span className="text-[9px] text-fg-subtle flex-shrink-0 tabular-nums">{formatSize(entry.size)}</span>
      )}
    </div>
  );
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function getBaseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i).toLowerCase() : name.toLowerCase();
}

function FileIcon({ name }: { name: string }): JSX.Element {
  const ext = getExt(name);
  const base = getBaseName(name);

  if (base === 'dockerfile' || name.toLowerCase() === 'dockerfile') return <LangIcon color="#2496ED" text="Docker" />;
  if (base === 'makefile' || name.toLowerCase() === 'makefile') return <LangIcon color="#6B7280" text="Make" />;
  if (base === 'readme') return <MarkdownIcon />;
  if (base === 'license' || name.toLowerCase().startsWith('license')) return <GenericFileIcon />;

  switch (ext) {
    case 'go': return <GoIcon />;
    case 'json': return <JsonIcon />;
    case 'js': return <LangIcon color="#F7DF1E" text="JS" />;
    case 'ts': return <LangIcon color="#3178C6" text="TS" />;
    case 'jsx': return <LangIcon color="#61DAFB" text="JSX" />;
    case 'tsx': return <LangIcon color="#3178C6" text="TSX" />;
    case 'py': return <LangIcon color="#3776AB" text="Py" />;
    case 'rs': return <LangIcon color="#DEA584" text="Rs" />;
    case 'java': return <LangIcon color="#B07219" text="Java" />;
    case 'cpp':
    case 'cc':
    case 'cxx': return <LangIcon color="#00599C" text="C++" />;
    case 'c': return <LangIcon color="#555555" text="C" />;
    case 'cs': return <LangIcon color="#178600" text="C#" />;
    case 'rb': return <LangIcon color="#CC342D" text="Rb" />;
    case 'php': return <LangIcon color="#4F5D95" text="PHP" />;
    case 'swift': return <LangIcon color="#F05138" text="Swift" />;
    case 'kt': return <LangIcon color="#A97BFF" text="Kotlin" />;
    case 'html':
    case 'htm': return <LangIcon color="#E34C26" text="HTML" />;
    case 'css': return <LangIcon color="#264DE4" text="CSS" />;
    case 'scss':
    case 'sass': return <LangIcon color="#CC6699" text="SCSS" />;
    case 'md':
    case 'mdx': return <MarkdownIcon />;
    case 'yaml':
    case 'yml': return <LangIcon color="#CB171E" text="YAML" />;
    case 'toml': return <LangIcon color="#9C4121" text="TOML" />;
    case 'env': return <LangIcon color="#AFCB05" text="ENV" />;
    case 'sql': return <LangIcon color="#F29111" text="SQL" />;
    case 'sh':
    case 'bash': return <LangIcon color="#89E051" text="SH" />;
    case 'ps1': return <LangIcon color="#2671BE" text="PS" />;
    case 'vue': return <LangIcon color="#41B883" text="Vue" />;
    case 'svelte': return <LangIcon color="#FF3E00" text="Svelte" />;
    case 'angular': return <LangIcon color="#DD0031" text="Ng" />;
    case 'svg': return <LangIcon color="#FFB13B" text="SVG" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp': return <ImageIcon />;
    case 'pdf': return <PdfIcon />;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z': return <ArchiveIcon />;
    case 'gitignore': return <GitIcon />;
    default: return <GenericFileIcon />;
  }
}

function GoIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="flex-shrink-0">
      <ellipse cx="8" cy="8.5" rx="6" ry="6.5" fill="#00ADD8" />
      <ellipse cx="5" cy="6.5" rx="1.8" ry="2.2" fill="#fff" />
      <ellipse cx="11" cy="6.5" rx="1.8" ry="2.2" fill="#fff" />
      <circle cx="5" cy="6.5" r="0.8" fill="#1a1a1a" />
      <circle cx="11" cy="6.5" r="0.8" fill="#1a1a1a" />
      <rect x="6" y="11" width="1.3" height="1.8" rx="0.2" fill="#fff" />
      <rect x="8.7" y="11" width="1.3" height="1.8" rx="0.2" fill="#fff" />
    </svg>
  );
}

function JsonIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="flex-shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#6B7280" />
      <text x="8" y="11" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="ui-monospace, monospace" fontWeight="bold">{ }</text>
    </svg>
  );
}

function LangIcon({ color, text }: { color: string; text: string }): JSX.Element {
  const fontSize = text.length > 2 ? 5 : 6;
  const y = text.length > 2 ? 10.5 : 11;
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="flex-shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill={color} />
      <text x="8" y={y} textAnchor="middle" fill="#fff" fontSize={fontSize} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">{text}</text>
    </svg>
  );
}

function MarkdownIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="flex-shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#083FA6" />
      <text x="8" y="11" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="bold">M↓</text>
    </svg>
  );
}

function ImageIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8B5CF6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <circle cx="5.5" cy="6" r="1" />
      <path d="M3 12l3-3 2.5 2.5L12 8l1 1" />
    </svg>
  );
}

function PdfIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="flex-shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#E43D32" />
      <text x="8" y="11" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="bold">PDF</text>
    </svg>
  );
}

function ArchiveIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 7h12" />
      <path d="M7 2v3M9 2v3" />
    </svg>
  );
}

function GitIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#F05032" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="5" cy="11" r="1.5" />
      <circle cx="11" cy="11" r="1.5" />
      <path d="M8 7.5v2.5M5 9.5v-1c0-1.5 1.5-2 3-2s3 .5 3 2v1" />
    </svg>
  );
}

function GenericFileIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-4z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className={spinning ? 'animate-spin' : ''}>
      <path d="M2 7a5 5 0 018.5-3.5L12 5M12 7a5 5 0 01-8.5 3.5L2 9" strokeLinecap="round" />
      <path d="M10 2v3h3M4 12V9H1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
