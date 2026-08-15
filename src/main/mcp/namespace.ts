/**
 * MCP tool namespacing.
 *
 * Two servers may advertise the same tool name, and a server may advertise a
 * name a builtin already uses. Resolving by raw name is first-match-wins, so
 * today the loser is silently unreachable — the model calls `search` and gets
 * whichever server happens to be first in the map.
 *
 * The advertised name therefore carries the server: `mcp__<server>__<tool>`.
 * Double underscore, not a colon, because the Anthropic and OpenAI tool-name
 * schemas are `^[a-zA-Z0-9_-]{1,64}$` — a colon makes the whole request
 * invalid, which is a much worse failure than a collision.
 *
 * See REMAINING_WORK.md §3.6.
 */

export const MCP_PREFIX = 'mcp__';
/** Both providers cap tool names at 64 characters. */
export const MAX_TOOL_NAME = 64;

/** Reduce a server name to the characters a tool name may contain. */
export function slugifyServer(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'server';
}

/**
 * Build the advertised name for one MCP tool. Long names are truncated from
 * the *server* half first: the tool half is what the model reasons about, so
 * losing characters there costs more meaning.
 */
export function namespacedToolName(serverName: string, toolName: string): string {
  const tool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const budget = MAX_TOOL_NAME - MCP_PREFIX.length - 2 - tool.length;
  const slug = slugifyServer(serverName);
  if (budget <= 0) {
    // Nothing left for the server half — keep the prefix and the tail of the
    // tool name, which is the part that distinguishes sibling tools.
    return (MCP_PREFIX + tool).slice(0, MAX_TOOL_NAME);
  }
  return `${MCP_PREFIX}${slug.slice(0, budget)}__${tool}`;
}

/**
 * Give every tool a unique advertised name. Collisions after truncation get a
 * numeric suffix rather than overwriting each other — silently dropping one is
 * the bug this whole module exists to fix.
 */
export function assignUniqueNames(
  entries: Array<{ serverName: string; toolName: string }>,
  taken: Set<string> = new Set()
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const base = namespacedToolName(entry.serverName, entry.toolName);
    let name = base;
    let n = 2;
    while (taken.has(name)) {
      const suffix = `_${n++}`;
      name = base.slice(0, MAX_TOOL_NAME - suffix.length) + suffix;
    }
    taken.add(name);
    out.push(name);
  }
  return out;
}

/** True for a name this module produced. */
export function isNamespaced(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}
