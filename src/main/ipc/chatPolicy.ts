// Pure decision helpers for the chat IPC handler: retry backoff, fallback-chain
// abort rules, and the plan-mode tool filter.
//
// These live apart from chat.ts on purpose. chat.ts imports `electron` at the
// top, which throws outside a packaged Electron app — including in CI, where
// the install scripts that fetch the Electron binary are skipped. Keeping the
// pure logic in an electron-free module lets it be unit tested with plain tsx.
import type { HiveErrorInfo, ProviderFallback, ToolDefinition } from '@shared/types';

export const STREAM_RETRY_BASE_DELAY_MS = 800;
// Provider Retry-After hints are honored for rate limits, but capped so a
// hostile or buggy hint cannot stall a turn indefinitely.
export const MAX_RATE_LIMIT_DELAY_MS = 60_000;

// Whether the fallback chain must stop rather than advance to `next`.
//
// The decision is per-target, not per-kind: an error that is fatal for one
// target may be irrelevant to the next one.
//   - invalid_request is target-specific (unknown model id, unsupported
//     params). A different target may accept the same request, so never abort
//     on it — some gateways (OpenCode Zen) even answer an unknown model with
//     401, which lands here as `auth`.
//   - auth/quota are provider-scoped (credentials, billing). They will repeat
//     identically on another target from the *same* provider, but say nothing
//     about a different provider — abort only when the next hop shares the
//     provider, otherwise the fallback the user configured is pointless.
// Everything else (rate_limit, overloaded, network, unknown) may advance.
export function shouldAbortFallbackChain(
  info: HiveErrorInfo,
  current?: ProviderFallback,
  next?: ProviderFallback
): boolean {
  if (info.kind !== 'auth' && info.kind !== 'quota') return false;
  // Without a next hop to compare against, keep the conservative behavior of
  // surfacing the credential/billing failure as-is.
  if (!current || !next) return true;
  return next.providerId === current.providerId;
}

// Backoff before a same-target retry. Rate limits carry a provider hint
// (Retry-After); honor it, capped at MAX_RATE_LIMIT_DELAY_MS.
export function retryDelayForError(info: HiveErrorInfo, attempt: number, baseDelayMs = STREAM_RETRY_BASE_DELAY_MS): number {
  if (info.kind === 'rate_limit' && typeof info.retryAfterMs === 'number' && info.retryAfterMs > 0) {
    return Math.min(info.retryAfterMs, MAX_RATE_LIMIT_DELAY_MS);
  }
  return baseDelayMs * attempt;
}

// Plan mode (workstream 1F): read-only inspection tools the model may use
// while planning. Mirrors the CLI's safe set (cli/src/services/chat.ts).
export const PLAN_SAFE_TOOL_NAMES = new Set([
  'read_file',
  'list_directory',
  'glob_files',
  'grep_files',
  'lint_dvm_basic',
  'get_simulator_chain_info'
]);

// Advertised-tool filter for plan mode: built-in, read-only tools only —
// mutating, shell, media-generation, and third-party MCP tools are never
// offered to the model.
export function filterPlanSafeTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => tool.source === 'builtin' && PLAN_SAFE_TOOL_NAMES.has(tool.name));
}
