// Strip <think> / <thinking> / <thought> blocks from model output and return
// the cleaned content plus the extracted reasoning text. Handles both single and
// multiple blocks, as well as unclosed/streaming tags and HTML-escaped variants.

export interface ThinkingExtraction {
  content: string;
  thinking: string;
}

const THINK_TAG_NAMES = ['think', 'thinking', 'thought'];
const TAG_NAMES = THINK_TAG_NAMES.join('|');
const TAG_PATTERN = `(?:${TAG_NAMES})(?:\\b[^>]*?)?`;
const THINK_RE = new RegExp(`<${TAG_PATTERN}>([\\s\\S]*?)</(?:${TAG_NAMES})>`, 'gi');
const ESCAPED_THINK_RE = new RegExp(`&lt;${TAG_PATTERN}&gt;([\\s\\S]*?)&lt;\\/(?:${TAG_NAMES})&gt;`, 'gi');
const STRAY_CLOSE_RE = new RegExp(`</(?:${TAG_NAMES})>`, 'gi');
const STRAY_ESCAPED_CLOSE_RE = new RegExp(`&lt;\\/(?:${TAG_NAMES})&gt;`, 'gi');
const OPEN_TAG_RE = new RegExp(`<${TAG_PATTERN}>`, 'i');
const ESCAPED_OPEN_TAG_RE = new RegExp(`&lt;${TAG_PATTERN}&gt;`, 'i');
const CLOSE_TAG_RE = new RegExp(`</(?:${TAG_NAMES})>`, 'i');
const ESCAPED_CLOSE_TAG_RE = new RegExp(`&lt;\\/(?:${TAG_NAMES})&gt;`, 'i');

function stripThinkingBlocks(raw: string, matches: string[]): string {
  return raw
    .replace(THINK_RE, (_m, body: string) => {
      matches.push(body.trim());
      return '';
    })
    .replace(ESCAPED_THINK_RE, (_m, body: string) => {
      matches.push(body.trim());
      return '';
    })
    .replace(STRAY_CLOSE_RE, '')
    .replace(STRAY_ESCAPED_CLOSE_RE, '');
}

export function extractThinking(raw: string): ThinkingExtraction {
  if (!raw) return { content: raw, thinking: '' };

  const matches: string[] = [];
  let clean = stripThinkingBlocks(raw, matches);

  // Handle unclosed thinking tag (still streaming) — hide everything after it
  const openMatch = raw.match(OPEN_TAG_RE) || raw.match(ESCAPED_OPEN_TAG_RE);
  if (openMatch) {
    const openIdx = openMatch.index ?? 0;
    const afterOpen = raw.slice(openIdx);
    const hasClose = CLOSE_TAG_RE.test(afterOpen) || ESCAPED_CLOSE_TAG_RE.test(afterOpen);
    if (!hasClose) {
      const pending = afterOpen
        .replace(OPEN_TAG_RE, '')
        .replace(ESCAPED_OPEN_TAG_RE, '')
        .trim();
      matches.push(pending);
      clean = stripThinkingBlocks(raw.slice(0, openIdx), []);
    }
  }

  // Collapse excessive blank lines left after stripping
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  return {
    content: clean,
    thinking: matches.join('\n\n').trim()
  };
}
