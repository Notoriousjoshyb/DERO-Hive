import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../utils/paths';
import { logger } from '../utils/logger';

/**
 * Tool-output spill: keep oversized tool results out of the model's context
 * without losing them. A result over the inline cap is written to disk in full
 * and replaced with a bounded head/tail preview plus the path, so the model can
 * `read_file` or `grep_files` its way back to the parts it actually needs.
 *
 * Adapted from the DeepSeek Harness spill design (MIT) — see
 * HARNESS_INTEGRATION_PLAN.md. The security-relevant choices are theirs:
 * a private root, an unguessable filename prefix, and an exclusive create.
 */

/** Results at or below this stay inline verbatim. */
export const DEFAULT_MAX_INLINE_BYTES = 16_000;

/** How much of an oversized result still reaches the model, in characters. */
const HEAD_CHARS = 2_000;
const TAIL_CHARS = 1_000;

export interface SpillRef {
  /** Absolute path to the full output. */
  path: string;
  /** Byte length of the full text. */
  bytes: number;
}

/**
 * Persist `text` and return where it landed, or null if it could not be
 * written. Callers treat null as "keep the inline result" — spilling is an
 * optimisation, never a reason to lose a tool's output.
 */
/** Directory holding one conversation's spilled output. */
function bucketDir(conversationId: string): string {
  // The conversation id is hashed rather than used directly: the spill root is
  // shared, and a directory name is not the place to publish session ids.
  return join(paths.spill, `session-${createHash('sha256').update(conversationId).digest('hex').slice(0, 16)}`);
}

/**
 * Drop a conversation's spilled output. Called when the conversation is
 * deleted, alongside the checkpoint prune.
 *
 * Known limitation, inherited knowingly from dsh: a conversation forked from
 * this one may still hold a message referencing one of these paths. Reading it
 * afterwards fails with "file not found", which is the honest answer — the
 * alternative is spill files that live forever.
 */
export function pruneSpill(conversationId: string): void {
  try {
    rmSync(bucketDir(conversationId), { recursive: true, force: true });
  } catch (err) {
    logger.warn('spill', `could not prune spill for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function saveSpill(text: string, conversationId: string, suggestedName: string): SpillRef | null {
  try {
    const dir = bucketDir(conversationId);
    // 0700: on POSIX this keeps other local users out of spilled tool output.
    // Windows ignores the mode — there the exclusive create below is what
    // actually carries the weight.
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Unpredictable prefix defeats symlink planting in a shared root; the
    // suffix is the tool name reduced to one safe path segment so the model
    // sees a name it can reason about.
    const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'output';
    const file = join(dir, `${randomBytes(8).toString('hex')}-${safeName}.txt`);

    // 'wx' fails if the path exists at all — symlink or not — so a planted
    // target cannot redirect this write somewhere else.
    writeFileSync(file, text, { flag: 'wx', mode: 0o600, encoding: 'utf-8' });
    return { path: file, bytes: Buffer.byteLength(text, 'utf-8') };
  } catch (err) {
    logger.warn('spill', `could not persist tool output: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Build the model-facing replacement for an oversized result: a head/tail
 * preview, an explicit note of how much was elided, and the retrieval hint.
 */
export function spillPreview(text: string, ref: SpillRef): string {
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.length > HEAD_CHARS + TAIL_CHARS ? text.slice(-TAIL_CHARS) : '';
  const elided = text.length - head.length - tail.length;

  const parts = [
    `[Output too large to include in full: ${ref.bytes.toLocaleString()} bytes.`,
    ` Showing the first ${head.length.toLocaleString()} characters${tail ? ` and the last ${tail.length.toLocaleString()}` : ''}.]`,
    '\n\n',
    head
  ];
  if (tail) parts.push(`\n\n... [${elided.toLocaleString()} characters elided] ...\n\n`, tail);
  parts.push(
    `\n\n[Full output saved to: ${ref.path}`,
    `\nRead that file, or grep_files it, to retrieve the parts you need.]`
  );
  return parts.join('');
}

/**
 * Apply the spill policy to a tool result's text. Returns the original when it
 * fits inline or when persisting failed.
 */
export function applySpill(
  content: string,
  conversationId: string,
  toolName: string,
  maxInlineBytes = DEFAULT_MAX_INLINE_BYTES
): { content: string; spilled?: SpillRef } {
  if (Buffer.byteLength(content, 'utf-8') <= maxInlineBytes) return { content };
  const ref = saveSpill(content, conversationId, toolName);
  if (!ref) return { content };
  return { content: spillPreview(content, ref), spilled: ref };
}
