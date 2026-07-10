#!/usr/bin/env bash
# Fail CI if any symbol from .github/forbidden-symbols.txt reappears
# in tracked source files. See that file's header for format + intent.
#
# Uses git grep so the check only sees files actually committed to the
# repo — local build caches, binaries, and gitignored paths are skipped
# automatically. This also matches what CI will see (clean checkout).

set -euo pipefail

LIST=".github/forbidden-symbols.txt"
SELF=".github/scripts/check-forbidden-symbols.sh"

if [ ! -f "$LIST" ]; then
  echo "::error::forbidden-symbols list missing at $LIST"
  exit 2
fi

# Paths that legitimately reference the symbols (this script + the list
# itself + the design exploration HTML which documents the bug history).
# Excluded via git grep pathspec.
EXCLUDE_PATHSPECS=(
  ":(exclude)${LIST}"
  ":(exclude)${SELF}"
  # Compiled artifacts contain symbol strings but aren't source; never committed,
  # but excluded defensively so a stray force-add can't trip the guard.
  ":(exclude)bin/**"
  ":(exclude)build/**"
)

violations=0

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  # Strip trailing comments + whitespace.
  line="${raw_line%%#*}"
  line="${line## }"
  line="${line%% }"
  line="${line//$'\r'/}"
  [ -z "$line" ] && continue

  # Optional scope:
  #   symbol@@<raw git pathspec>   — passed verbatim (preserves a leading ':', so
  #                                  ':(exclude)foo.go' forbids everywhere except foo.go)
  #   symbol::<glob>               — include-only glob (leading ':' would be stripped)
  if [[ "$line" == *"@@"* ]]; then
    symbol="${line%%@@*}"
    scope="${line##*@@}"
    matches="$(git grep -n -E "$symbol" -- "$scope" "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null || true)"
  elif [[ "$line" == *"::"* ]]; then
    symbol="${line%%::*}"
    scope="${line##*::}"
    matches="$(git grep -n -E "$symbol" -- "$scope" "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null || true)"
  else
    symbol="$line"
    matches="$(git grep -n -E "$symbol" -- "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null || true)"
  fi

  if [ -n "$matches" ]; then
    echo "::error::Forbidden symbol \"$symbol\" found:"
    printf '%s\n' "$matches" | sed 's/^/  /'
    violations=$((violations + 1))
  fi
done < "$LIST"

if [ "$violations" -gt 0 ]; then
  echo
  echo "::error::$violations forbidden-symbol violation(s) detected."
  echo "If reintroducing one of these is genuinely intentional, remove it from $LIST in the same commit and document why in the PR description."
  exit 1
fi

echo "Forbidden-symbol check: clean."
