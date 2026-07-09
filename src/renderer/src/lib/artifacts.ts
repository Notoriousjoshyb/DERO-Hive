// Extract fenced code blocks from assistant messages and save as artifacts.
// Detects ```html, ```svg, ```mermaid, ```react, ```tsx, etc.

export interface ExtractedArtifact {
  type: 'code' | 'html' | 'svg' | 'react' | 'mermaid';
  language?: string;
  title?: string;
  content: string;
}

const PREVIEWABLE = new Set(['html', 'svg', 'mermaid', 'react', 'jsx', 'tsx']);

export function extractArtifacts(content: string): ExtractedArtifact[] {
  const out: ExtractedArtifact[] = [];
  const fenceRegex = /```(\w*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(content)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2];
    let type: ExtractedArtifact['type'] = 'code';
    if (lang === 'html') type = 'html';
    else if (lang === 'svg') type = 'svg';
    else if (lang === 'mermaid') type = 'mermaid';
    else if (lang === 'react' || lang === 'jsx' || lang === 'tsx') type = 'react';

    if (type !== 'code' || PREVIEWABLE.has(lang)) {
      out.push({ type, language: lang || undefined, content: body });
    }
  }

  // Also detect standalone <svg>...</svg> in HTML
  if (!out.some((a) => a.type === 'svg')) {
    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
    if (svgMatch) {
      out.push({ type: 'svg', language: 'svg', content: svgMatch[0] });
    }
  }

  return out;
}