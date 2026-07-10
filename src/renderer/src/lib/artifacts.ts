// Extract Vision artifacts (fenced code blocks) from assistant messages.
// Detects ```html, ```svg, ```mermaid, ```react/jsx/tsx and ```markdown/md.
// Only closed fences are extracted, so this is safe to run on a streaming
// message — a half-written block won't produce a broken artifact.

export interface ExtractedArtifact {
  type: 'code' | 'html' | 'svg' | 'react' | 'mermaid' | 'markdown';
  language?: string;
  title?: string;
  content: string;
}

const MIN_ARTIFACT_CHARS = 40;

const LANG_TO_TYPE: Record<string, ExtractedArtifact['type']> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  react: 'react',
  jsx: 'react',
  tsx: 'react',
  markdown: 'markdown',
  md: 'markdown'
};

export function extractArtifacts(content: string): ExtractedArtifact[] {
  const out: ExtractedArtifact[] = [];
  // Anchor fences to line starts so inline backticks don't confuse the parser.
  // The closing fence must exist (no $ fallback) — see streaming note above.
  const fenceRegex = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(content)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2].trim();
    const type = LANG_TO_TYPE[lang];
    if (!type) continue;
    if (body.length < MIN_ARTIFACT_CHARS) continue;
    // A markdown fence that is really prose commentary (no headings/structure)
    // still counts — documents are a first-class Vision type.
    out.push({
      type,
      language: lang || undefined,
      title: deriveTitle(type, body, content, m.index),
      content: body
    });
  }

  // Also detect a standalone <svg>...</svg> outside fences
  if (!out.some((a) => a.type === 'svg')) {
    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
    if (svgMatch && svgMatch[0].length >= MIN_ARTIFACT_CHARS && !insideFence(content, svgMatch.index || 0)) {
      out.push({
        type: 'svg',
        language: 'svg',
        title: deriveTitle('svg', svgMatch[0], content, svgMatch.index || 0),
        content: svgMatch[0]
      });
    }
  }

  return out;
}

// True when the given offset falls inside a fenced code block.
function insideFence(content: string, offset: number): boolean {
  const before = content.slice(0, offset);
  const fences = (before.match(/^```/gm) || []).length;
  return fences % 2 === 1;
}

// Title priority: the heading/bold line immediately preceding the fence wins —
// the system prompt asks models to keep it stable across revisions, so it's
// the reliable versioning key. Embedded titles (<title>, <h1>, first md
// heading, component name) are fallbacks.
function deriveTitle(type: ExtractedArtifact['type'], body: string, fullContent: string, fenceIndex: number): string | undefined {
  const preceding = precedingHeading(fullContent, fenceIndex);
  if (preceding) return preceding;

  if (type === 'html') {
    const t = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
      || body.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
    if (t) return clip(t);
  }
  if (type === 'svg') {
    const t = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    if (t) return clip(t);
  }
  if (type === 'markdown') {
    const t = body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    if (t) return clip(t);
  }
  if (type === 'react') {
    // Component name reads well as a title: "export default function TodoApp"
    const t = body.match(/(?:export\s+default\s+)?function\s+([A-Z]\w+)/)?.[1]
      || body.match(/const\s+([A-Z]\w+)\s*[:=]/)?.[1];
    if (t) return t;
  }

  return undefined;
}

// Heading or bold line in the last two non-empty lines before the fence
function precedingHeading(fullContent: string, fenceIndex: number): string | undefined {
  const before = fullContent.slice(0, fenceIndex).split('\n').filter((l) => l.trim()).slice(-2);
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    const h = line.match(/^#{1,4}\s+(.+?)[:\s]*$/)?.[1]
      || line.match(/^\*\*(.+?)\*\*[:\s]*$/)?.[1];
    if (h) return clip(h);
  }
  return undefined;
}

function clip(s: string): string {
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

// Stable identity for versioning: artifacts with the same type + title in a
// conversation are versions of the same thing.
export function artifactGroupKey(a: { type: string; title?: string; language?: string }): string {
  return `${a.type}|${(a.title || '').toLowerCase().trim()}`;
}

// Friendly display name for an artifact: its title, or a readable type name.
export function artifactLabel(a: { type: string; title?: string }): string {
  return a.title || ({
    html: 'Web page',
    react: 'React app',
    svg: 'SVG graphic',
    mermaid: 'Diagram',
    markdown: 'Document',
    code: 'Code'
  } as Record<string, string>)[a.type] || a.type;
}

export function hasPreviewableArtifact(content: string): boolean {
  const fenceRegex = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(content)) !== null) {
    const type = LANG_TO_TYPE[(m[1] || '').toLowerCase()];
    if (type && m[2].trim().length >= MIN_ARTIFACT_CHARS) return true;
  }
  return false;
}
