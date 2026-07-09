// Colorful VSCode-style file-type icons keyed by extension. Most are compact
// brand-coloured letter badges; React files get the atom mark.

interface Badge { label: string; bg: string; fg: string }

const EXT_BADGE: Record<string, Badge> = {
  js: { label: 'JS', bg: '#f7df1e', fg: '#1e1e1e' },
  mjs: { label: 'JS', bg: '#f7df1e', fg: '#1e1e1e' },
  cjs: { label: 'JS', bg: '#f7df1e', fg: '#1e1e1e' },
  ts: { label: 'TS', bg: '#3178c6', fg: '#ffffff' },
  mts: { label: 'TS', bg: '#3178c6', fg: '#ffffff' },
  json: { label: '{ }', bg: '#f5b942', fg: '#1e1e1e' },
  md: { label: 'M↓', bg: '#519aba', fg: '#ffffff' },
  mdx: { label: 'M↓', bg: '#519aba', fg: '#ffffff' },
  css: { label: '#', bg: '#2965f1', fg: '#ffffff' },
  scss: { label: 'S', bg: '#cf649a', fg: '#ffffff' },
  less: { label: 'L', bg: '#1d365d', fg: '#ffffff' },
  html: { label: '<>', bg: '#e34f26', fg: '#ffffff' },
  htm: { label: '<>', bg: '#e34f26', fg: '#ffffff' },
  xml: { label: '<>', bg: '#f1662a', fg: '#ffffff' },
  svg: { label: '▲', bg: '#ffb13b', fg: '#1e1e1e' },
  go: { label: 'GO', bg: '#00add8', fg: '#ffffff' },
  py: { label: 'PY', bg: '#3776ab', fg: '#ffd43b' },
  rs: { label: 'RS', bg: '#dea584', fg: '#1e1e1e' },
  rb: { label: 'RB', bg: '#cc342d', fg: '#ffffff' },
  java: { label: 'J', bg: '#e76f00', fg: '#ffffff' },
  kt: { label: 'KT', bg: '#7f52ff', fg: '#ffffff' },
  c: { label: 'C', bg: '#5c6bc0', fg: '#ffffff' },
  h: { label: 'H', bg: '#5c6bc0', fg: '#ffffff' },
  cpp: { label: 'C+', bg: '#00599c', fg: '#ffffff' },
  hpp: { label: 'C+', bg: '#00599c', fg: '#ffffff' },
  cc: { label: 'C+', bg: '#00599c', fg: '#ffffff' },
  cs: { label: 'C#', bg: '#68217a', fg: '#ffffff' },
  php: { label: 'PHP', bg: '#777bb4', fg: '#ffffff' },
  swift: { label: 'SW', bg: '#f05138', fg: '#ffffff' },
  scala: { label: 'SC', bg: '#dc322f', fg: '#ffffff' },
  sh: { label: '›_', bg: '#4eaa25', fg: '#ffffff' },
  bash: { label: '›_', bg: '#4eaa25', fg: '#ffffff' },
  zsh: { label: '›_', bg: '#4eaa25', fg: '#ffffff' },
  ps1: { label: '›_', bg: '#012456', fg: '#ffffff' },
  bat: { label: '›_', bg: '#4d4d4d', fg: '#ffffff' },
  cmd: { label: '›_', bg: '#4d4d4d', fg: '#ffffff' },
  yml: { label: 'Y', bg: '#a97bff', fg: '#ffffff' },
  yaml: { label: 'Y', bg: '#a97bff', fg: '#ffffff' },
  toml: { label: 'T', bg: '#9c4221', fg: '#ffffff' },
  ini: { label: 'C', bg: '#6d8086', fg: '#ffffff' },
  env: { label: 'E', bg: '#ecd53f', fg: '#1e1e1e' },
  sql: { label: 'DB', bg: '#dad8d8', fg: '#1e1e1e' },
  vue: { label: 'V', bg: '#42b883', fg: '#ffffff' },
  svelte: { label: 'S', bg: '#ff3e00', fg: '#ffffff' },
  lock: { label: '⚿', bg: '#787878', fg: '#ffffff' },
  txt: { label: '≡', bg: '#6d8086', fg: '#ffffff' },
  csv: { label: '▦', bg: '#217346', fg: '#ffffff' },
  dockerfile: { label: '🐳', bg: '#2496ed', fg: '#ffffff' }
};

function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower.endsWith('.gitignore') || lower === '.gitignore') return 'git';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
}

export function FileTypeIcon({ name, size = 13 }: { name: string; size?: number }): JSX.Element {
  const ext = extOf(name);

  // React files get the atom mark.
  if (ext === 'jsx' || ext === 'tsx') {
    return <ReactAtom size={size} accent={ext === 'tsx' ? '#3178c6' : '#61dafb'} />;
  }
  if (ext === 'git') {
    return <Badge size={size} badge={{ label: 'git', bg: '#f05133', fg: '#ffffff' }} />;
  }

  const badge = EXT_BADGE[ext];
  if (badge) return <Badge size={size} badge={badge} />;

  // Generic file glyph
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" className="text-fg-subtle flex-shrink-0">
      <path d="M3.5 1.5h5L11 4v8.5h-7.5z" />
      <path d="M8.5 1.5V4H11" />
    </svg>
  );
}

function Badge({ badge, size }: { badge: Badge; size: number }): JSX.Element {
  const fontSize = badge.label.length >= 3 ? size * 0.36 : size * 0.5;
  return (
    <span
      className="inline-flex items-center justify-center rounded-[3px] font-bold flex-shrink-0 leading-none select-none"
      style={{ width: size, height: size, background: badge.bg, color: badge.fg, fontSize: `${fontSize}px` }}
    >
      {badge.label}
    </span>
  );
}

function ReactAtom({ size, accent }: { size: number; accent: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
      <circle cx="12" cy="12" r="2" fill={accent} />
      <g stroke={accent} strokeWidth="1">
        <ellipse cx="12" cy="12" rx="10" ry="4.3" />
        <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(120 12 12)" />
      </g>
    </svg>
  );
}
