/**
 * LSP wire framing: `Content-Length: N\r\n\r\n<N bytes of JSON>`.
 *
 * This is the part of an LSP client that quietly breaks: the length is in
 * **bytes**, not characters, and a chunk boundary can land anywhere — inside a
 * header, between the headers and the body, or halfway through a multi-byte
 * character. Splitting on strings works right up until a language server sends
 * a symbol name with an accent in it.
 *
 * So the framer buffers Buffers, never strings, and only decodes once it holds
 * a whole message.
 */

export interface LspMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Serialize one message with its header. */
export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

const HEADER_END = Buffer.from('\r\n\r\n', 'ascii');

export class LspFramer {
  private buffer = Buffer.alloc(0);

  /**
   * Feed raw stdout. Returns every complete message now available, in order.
   * A malformed body is skipped rather than thrown: one bad message must not
   * desynchronize the stream for every message after it.
   */
  push(chunk: Buffer): LspMessage[] {
    // Always copy rather than adopting the chunk when the buffer is empty: a
    // stream chunk may be backed by a SharedArrayBuffer, and holding onto one
    // means holding onto whatever else shares it.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: LspMessage[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // No length to trust — drop the header and resynchronize.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + HEADER_END.length;
      if (this.buffer.length < bodyStart + length) break; // body still arriving

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf-8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        out.push(JSON.parse(body) as LspMessage);
      } catch {
        // Skip it. The framing was valid, so the stream is still aligned.
      }
    }

    return out;
  }

  /** Bytes held back waiting for the rest of a message. */
  get pending(): number {
    return this.buffer.length;
  }
}

/** file path → `file://` URI, with Windows drive letters handled. */
export function pathToUri(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  // encodeURI leaves '#' and '?' alone, and both are legal in file names.
  return `file://${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

/** `file://` URI → file path. Returns the input unchanged if it is not a file URI. */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const decoded = decodeURIComponent(uri.slice('file://'.length));
  // '/C:/x' is a Windows path wearing a URI hat.
  const stripped = /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
  return process.platform === 'win32' ? stripped.replace(/\//g, '\\') : stripped;
}
