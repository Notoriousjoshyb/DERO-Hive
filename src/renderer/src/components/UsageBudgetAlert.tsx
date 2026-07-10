import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { UsageStats } from '@shared/types';

export function UsageBudgetAlert(): JSX.Element | null {
  const settings = useAppStore((s) => s.settings);
  const lastStreamFinishedAt = useAppStore((s) => s.lastStreamFinishedAt);
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    window.hive.usageStats().then(setStats).catch(() => setStats(null));
  }, [lastStreamFinishedAt]);

  if (!stats) return null;

  const daily = stats.today.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
  const monthly = stats.month.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
  const dailyBudget = settings.dailyTokenBudget || 0;
  const monthlyBudget = settings.monthlyTokenBudget || 0;

  const dailyExceeded = dailyBudget > 0 && daily >= dailyBudget;
  const monthlyExceeded = monthlyBudget > 0 && monthly >= monthlyBudget;
  if (!dailyExceeded && !monthlyExceeded) return null;

  return (
    <div className="px-3 py-1.5 bg-warn/10 border border-warn/30 rounded-md text-xs text-warn flex items-center gap-2">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 1.5l6.5 12H1.5z" />
        <path d="M8 6.5v3" />
      </svg>
      <span>
        Budget alert:
        {dailyExceeded && ` ${daily.toLocaleString()} / ${dailyBudget.toLocaleString()} tokens today`}
        {dailyExceeded && monthlyExceeded && '; '}
        {monthlyExceeded && ` ${monthly.toLocaleString()} / ${monthlyBudget.toLocaleString()} tokens this month`}
      </span>
    </div>
  );
}
