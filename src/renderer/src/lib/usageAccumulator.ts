// Live per-turn token/cost accumulator (Phase 1A).
//
// The main process forwards every provider usage report as a `usage` stream
// event and sums them per agentic round (`roundUsage` in src/main/ipc/chat.ts).
// This helper mirrors that accumulation in the renderer so the TokenUsage bar
// can update DURING streaming instead of only when the turn persists.
//
// Kept dependency-free (no @shared imports) so the tsx test next to it runs
// without path-alias resolution. `UsageReport` is structurally compatible
// with `TokenUsage` from @shared/types.

export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  cachedTokens?: number;
}

/** $/1M tokens, matching ProviderModel.inputPrice/outputPrice. */
export interface ModelPrices {
  input?: number;
  output?: number;
}

export interface LiveUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** Usage reports folded in so far (≈ billable API calls this turn). */
  reports: number;
  /** Dollars. Only set once at least one report had pricing information. */
  estimatedCost?: number;
}

export function emptyLiveUsage(): LiveUsage {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, reports: 0 };
}

/** Cost of a single usage report in dollars, or undefined when unpriced. */
export function reportCost(report: UsageReport, prices?: ModelPrices): number | undefined {
  if (!prices || (prices.input == null && prices.output == null)) return undefined;
  return (report.promptTokens * (prices.input ?? 0) + report.completionTokens * (prices.output ?? 0)) / 1_000_000;
}

/**
 * Fold one provider usage report into the running tally. Reports are
 * per-API-call deltas, so they ADD — replacing would drop earlier agentic
 * rounds, and double-counting is impossible because each report is sent once.
 */
export function applyUsageReport(acc: LiveUsage, report: UsageReport, prices?: ModelPrices): LiveUsage {
  const cost = reportCost(report, prices);
  return {
    promptTokens: acc.promptTokens + (report.promptTokens || 0),
    completionTokens: acc.completionTokens + (report.completionTokens || 0),
    cachedTokens: acc.cachedTokens + (report.cachedTokens ?? 0),
    reports: acc.reports + 1,
    estimatedCost: cost !== undefined ? (acc.estimatedCost ?? 0) + cost : acc.estimatedCost
  };
}
