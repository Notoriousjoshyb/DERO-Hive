/**
 * Multi-hunk edits: apply an ordered list of exact-text replacements to one
 * file atomically. Either every hunk applies or the file is left untouched —
 * a half-applied edit is the worst outcome for both the model and the user,
 * because neither the old nor the new state is true any more.
 *
 * See REMAINING_WORK.md §3.4.
 */

export interface EditHunk {
  /** Exact text to find. Must match uniquely unless replaceAll is set. */
  oldText: string;
  newText: string;
  /** Replace every occurrence instead of requiring a unique match. */
  replaceAll?: boolean;
}

export interface EditApplication {
  /** 1-based index of the hunk, as the caller supplied it. */
  index: number;
  /** How many occurrences this hunk replaced. */
  replaced: number;
  /** 1-based line number of the first replacement, in the pre-hunk text. */
  line: number;
}

export type EditResult =
  | { ok: true; text: string; applied: EditApplication[] }
  | { ok: false; error: string; failedHunk: number };

/**
 * Apply hunks in order against the evolving text. Order matters: a later hunk
 * sees the result of the earlier ones, which is what makes two edits to
 * overlapping regions well-defined rather than racy.
 */
export function applyEdits(source: string, hunks: EditHunk[]): EditResult {
  if (hunks.length === 0) return { ok: false, error: 'No edits supplied.', failedHunk: 0 };

  let text = source;
  const applied: EditApplication[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const n = i + 1;
    if (typeof hunk.oldText !== 'string' || hunk.oldText === '') {
      return { ok: false, error: `Edit ${n}: old_text must be a non-empty string.`, failedHunk: n };
    }
    if (typeof hunk.newText !== 'string') {
      return { ok: false, error: `Edit ${n}: new_text must be a string.`, failedHunk: n };
    }
    if (hunk.oldText === hunk.newText) {
      return { ok: false, error: `Edit ${n}: old_text and new_text are identical; nothing to do.`, failedHunk: n };
    }

    const occurrences = text.split(hunk.oldText).length - 1;
    if (occurrences === 0) {
      // Name the likely cause: after an earlier hunk, the most common reason a
      // later one misses is that it targeted text the earlier one rewrote.
      const hint = i > 0 ? ' It may have been changed by an earlier edit in this call.' : '';
      return { ok: false, error: `Edit ${n}: old_text not found.${hint} No edits were applied.`, failedHunk: n };
    }
    if (occurrences > 1 && !hunk.replaceAll) {
      return {
        ok: false,
        error: `Edit ${n}: old_text matches ${occurrences} locations; add more surrounding context to make it unique, or set replace_all. No edits were applied.`,
        failedHunk: n
      };
    }

    const at = text.indexOf(hunk.oldText);
    applied.push({ index: n, replaced: hunk.replaceAll ? occurrences : 1, line: lineOf(text, at) });
    // Function replacement so `$&` and friends in new_text are written literally.
    text = hunk.replaceAll
      ? text.split(hunk.oldText).join(hunk.newText)
      : text.replace(hunk.oldText, () => hunk.newText);
  }

  return { ok: true, text, applied };
}

/**
 * Read hunks out of raw tool arguments, accepting both the single-hunk form
 * (`old_text` / `new_text`) and the array form (`edits`). Returns null when
 * neither is present, so the caller can report one clear error.
 */
export function parseEditArgs(args: Record<string, unknown>): EditHunk[] | null {
  const raw = args.edits;
  if (Array.isArray(raw)) {
    return raw.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        oldText: typeof o.old_text === 'string' ? o.old_text : typeof o.oldText === 'string' ? o.oldText : '',
        newText: typeof o.new_text === 'string' ? o.new_text : typeof o.newText === 'string' ? o.newText : '',
        replaceAll: o.replace_all === true || o.replaceAll === true
      };
    });
  }
  if (typeof args.old_text === 'string') {
    return [{
      oldText: args.old_text,
      newText: typeof args.new_text === 'string' ? args.new_text : '',
      replaceAll: args.replace_all === true
    }];
  }
  return null;
}

function lineOf(text: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
