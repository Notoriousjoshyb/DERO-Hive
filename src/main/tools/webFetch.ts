import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * web_fetch: turn a URL into readable text the model can actually use.
 *
 * Three properties matter more than the conversion quality:
 *  - every hop is re-validated, because a public hostname can redirect to
 *    169.254.169.254 and the second request is the one that reaches metadata;
 *  - the body is capped while streaming, so a hostile server cannot make the
 *    main process buy an unbounded buffer;
 *  - a non-text content type is refused by name rather than dumped as bytes.
 *
 * See REMAINING_WORK.md §3.1.
 */

export const MAX_REDIRECTS = 5;
export const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export interface FetchOutcome {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  truncated: boolean;
  text: string;
}

/**
 * True for an address no outbound fetch should reach: loopback, link-local
 * (including the cloud metadata address), private ranges, carrier-grade NAT,
 * and their IPv6 equivalents.
 */
export function isBlockedAddress(addr: string): boolean {
  const v = addr.toLowerCase();
  if (isIP(v) === 6) {
    if (v === '::' || v === '::1') return true;
    // IPv4-mapped (::ffff:10.0.0.1) is an IPv4 address wearing a hat.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (/^f[cd]/.test(v)) return true;      // unique local fc00::/7
    if (v.startsWith('fe80')) return true;  // link local
    if (v.startsWith('ff')) return true;    // multicast
    return false;
  }
  const parts = v.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;           // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true;                          // multicast + reserved
  return false;
}

/** Validate one hop: scheme, hostname, and every address the host resolves to. */
export async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs can be fetched (got ${url.protocol.replace(':', '')}).`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost)$/i.test(host)) throw new Error('Refusing to fetch a loopback address.');

  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`Refusing to fetch a private or loopback address (${host}).`);
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  // Every address, not just the first: a host answering with one public and
  // one private address must not be reachable by luck of ordering.
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) throw new Error(`Refusing to fetch ${host}: it resolves to a private address (${a.address}).`);
  }
  return url;
}

/** Fetch a URL and return readable text, following redirects one hop at a time. */
export async function fetchUrl(raw: string): Promise<FetchOutcome> {
  let current = raw;
  let response: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertFetchable(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identify honestly; some sites 403 an empty agent.
          'user-agent': 'DERO-Hive/1.0 (+https://github.com/dero-hive)',
          accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop === MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
      current = new URL(location, url).toString();
      continue;
    }
    break;
  }

  if (!response) throw new Error('No response.');
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const finalUrl = current;

  if (!response.ok) {
    return { ok: false, url: raw, finalUrl, status: response.status, contentType, bytes: 0, truncated: false, text: `HTTP ${response.status} ${response.statusText}` };
  }

  const isText = /^(text\/|application\/(json|xml|xhtml|javascript|rss|atom)|application\/[a-z.+-]*\+(json|xml))/.test(contentType) || contentType === '';
  if (!isText) {
    return { ok: false, url: raw, finalUrl, status: response.status, contentType, bytes: 0, truncated: false, text: `Refusing to read a non-text response (content-type: ${contentType || 'unknown'}). Download it with run_shell if you need the bytes.` };
  }

  const { text: body, bytes, truncated } = await readCapped(response);
  const text = /html/.test(contentType) ? htmlToMarkdown(body) : body;
  return { ok: true, url: raw, finalUrl, status: response.status, contentType, bytes, truncated, text };
}

/** Read a body, stopping at the cap rather than buffering whatever arrives. */
async function readCapped(response: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) return { text: await response.text(), bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    chunks.push(value);
    if (bytes >= MAX_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => { /* already closed */ });
      break;
    }
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8'), bytes, truncated };
}

const BLOCK_TAGS = 'address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

/**
 * A deliberately small HTML-to-markdown pass: headings, links, list items,
 * code and emphasis, everything else flattened. It is a reading aid, not a
 * faithful converter — a model reading a page wants the prose and the links.
 */
export function htmlToMarkdown(html: string): string {
  let s = html;
  // Anything that is not content, in any order of attributes.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|canvas|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // <head> holds metadata, not reading material — the title is already in the URL.
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  // Prefer the main content region when the page marks one.
  const main = s.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (main && main[1].length > 400) s = main[1];

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${strip(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${strip(inner)}`);
  // Entities inside <pre> stay encoded here: the final decode below runs after
  // the last stripTags, so decoding early would turn `&lt;x&gt;` into a tag and
  // then delete it.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => `\n\n\`\`\`\n${stripTags(inner).trim()}\n\`\`\`\n\n`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${strip(inner)}\``);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${strip(inner)}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${strip(inner)}*`);
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = strip(inner);
    return label ? `[${label}](${href})` : '';
  });
  s = s.replace(new RegExp(`</(?:${BLOCK_TAGS})>`, 'gi'), '\n\n');
  s = stripTags(s);
  s = decode(s);
  // Collapse the whitespace the tag soup left behind.
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function strip(s: string): string {
  return decode(stripTags(s)).replace(/\s+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™'
};

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}
