import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { UsageModelRow, UsageStats } from '@shared/types';

type Period = 'today' | 'week' | 'month';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' }
];

// Token & estimated-cost dashboard. Token counts come from persisted per-message
// usage; prices come from the configured providers' model metadata ($/1M tokens).
export function UsagePanel(): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const lastStreamFinishedAt = useAppStore((s) => s.lastStreamFinishedAt);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.hive.usageStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
    // Refetch when a stream finishes so the just-persisted usage shows up.
  }, [lastStreamFinishedAt]);

  const priceFor = useMemo(() => {
    // Keyed by provider+model, with a model-only fallback for usage rows whose
    // provider config was since deleted/renamed.
    const map = new Map<string, { input?: number; output?: number }>();
    for (const p of providers) {
      for (const m of p.models) {
        if (m.inputPrice != null || m.outputPrice != null) {
          map.set(`${p.id}:${m.id}`, { input: m.inputPrice, output: m.outputPrice });
          if (!map.has(m.id)) map.set(m.id, { input: m.inputPrice, output: m.outputPrice });
        }
      }
    }
    return (provider: string, model: string): { input?: number; output?: number } | undefined =>
      map.get(`${provider}:${model}`) ?? map.get(model);
  }, [providers]);

  const rows: UsageModelRow[] = stats?.[period] ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      messages: acc.messages + r.messages,
      promptTokens: acc.promptTokens + r.promptTokens,
      completionTokens: acc.completionTokens + r.completionTokens,
      totalTokens: acc.totalTokens + r.totalTokens
    }),
    { messages: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  );

  const costOf = (r: UsageModelRow): number | null => {
    const price = priceFor(r.provider, r.model);
    if (!price || (price.input == null && price.output == null)) return null;
    return (r.promptTokens * (price.input ?? 0) + r.completionTokens * (price.output ?? 0)) / 1_000_000;
  };

  const knownCosts = rows.map(costOf).filter((c): c is number => c !== null);
  const totalCost = knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null;
  const hasUnpriced = rows.some((r) => costOf(r) === null);
  const maxTokens = Math.max(1, ...rows.map((r) => r.totalTokens));

  return (
    <div className="p-3 space-y-3 text-xs">
      {/* Period selector */}
      <div className="bg-bg-elev rounded-lg p-0.5 flex items-center border border-border">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition ${
              period === p.id ? 'bg-bg-input text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="text-danger">{error}</div>}
      {!stats && !error && <div className="text-fg-subtle py-4 text-center">Loading…</div>}

      {stats && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Total tokens" value={fmt(totals.totalTokens)} />
            <StatTile label="Est. cost" value={totalCost !== null ? `$${totalCost.toFixed(totalCost < 1 ? 4 : 2)}${hasUnpriced ? '+' : ''}` : '—'} />
            <StatTile label="Input" value={fmt(totals.promptTokens)} />
            <StatTile label="Output" value={fmt(totals.completionTokens)} />
          </div>

          {/* Per-model breakdown */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">By model</div>
            {rows.length === 0 && (
              <div className="text-fg-subtle py-3 text-center">No usage recorded {period === 'today' ? 'today' : 'in this period'}.</div>
            )}
            <div className="space-y-1.5">
              {rows.map((r) => {
                const cost = costOf(r);
                // cachedTokens isn't aggregated by the USAGE_STATS SQL yet — render only when present.
                const cached = (r as UsageModelRow & { cachedTokens?: number }).cachedTokens ?? 0;
                return (
                  <div key={`${r.provider}:${r.model}`} className="px-2.5 py-2 rounded-lg border border-border/60 bg-bg-elev/50">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-[10px] text-fg truncate" title={`${r.model} (${r.provider})`}>{r.model}</span>
                      <span className="text-[10px] text-fg-subtle tabular-nums flex-shrink-0">
                        {cost !== null ? `$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : ''}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-bg-input overflow-hidden mb-1">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(3, (r.totalTokens / maxTokens) * 100)}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-fg-subtle tabular-nums">
                      <span>{fmt(r.totalTokens)} tok · {r.messages} msg{r.messages === 1 ? '' : 's'}</span>
                      <span>{fmt(r.promptTokens)} in / {fmt(r.completionTokens)} out{cached > 0 ? ` · ${fmt(cached)} cached` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hasUnpriced && rows.length > 0 && (
            <div className="text-[9px] text-fg-subtle leading-relaxed">
              Some models have no price metadata — the “+” on the cost means the true total is higher. Prices come from provider presets ($/1M tokens).
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="px-2.5 py-2 rounded-lg border border-border/60 bg-bg-elev/50">
      <div className="text-[9px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="text-sm text-fg font-medium tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
