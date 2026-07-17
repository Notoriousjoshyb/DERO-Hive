// Scheduled-task model and schedule arithmetic.
//
// Kept free of React and of Date.now() so the arithmetic is testable: every
// function takes the current time as an argument.

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** Either a whole number of minutes ('60'), or a named preset below. */
  schedule: string;
  providerId: string;
  model: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  projectId?: string;
}

export const SCHEDULED_TASKS_KEY = 'hive-scheduled-tasks';

/** Local hour that the day-based presets fire at. */
export const DAILY_RUN_HOUR = 9;

export const SCHEDULE_PRESETS = [
  { label: 'Every hour', value: '60' },
  { label: 'Every 6 hours', value: '360' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekly (Mon)', value: 'weekly-mon' },
  { label: 'Custom (minutes)', value: 'custom' },
];

/** Minutes for an interval schedule, or null if `schedule` is a named preset. */
export function intervalMinutes(schedule: string): number | null {
  const n = Number(schedule);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The next time `schedule` should fire strictly after `from`.
 *
 * Interval schedules count from `from`. Day-based presets fire at
 * DAILY_RUN_HOUR local time on the next matching day — so a missed window
 * rolls forward to the next day rather than firing the instant the app opens.
 */
export function computeNextRunAt(schedule: string, from: number): number {
  const minutes = intervalMinutes(schedule);
  if (minutes !== null) return from + minutes * 60_000;

  const d = new Date(from);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAILY_RUN_HOUR, 0, 0, 0);
  // Strictly after `from` — today's slot has already passed if we're past it.
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);

  if (schedule === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  } else if (schedule === 'weekly-mon') {
    while (next.getDay() !== 1) next.setDate(next.getDate() + 1);
  }
  // 'daily' and anything unrecognized fall through as a plain next-day slot.
  return next.getTime();
}

/**
 * Tasks that are enabled and whose next run is due at `now`.
 *
 * A task with no nextRunAt is NOT due — it has not been scheduled yet (see
 * seedNextRunAt). Treating it as due would fire every task the first time the
 * app opened after the feature shipped.
 */
export function dueTasks(tasks: readonly ScheduledTask[], now: number): ScheduledTask[] {
  return tasks.filter((t) => t.enabled && typeof t.nextRunAt === 'number' && t.nextRunAt <= now);
}

/**
 * Give every enabled task a nextRunAt, scheduling forward from `now`.
 * Existing values are kept, so a pending run survives a restart. Disabled
 * tasks have their nextRunAt cleared — resuming one reschedules it.
 */
export function seedNextRunAt(tasks: readonly ScheduledTask[], now: number): ScheduledTask[] {
  return tasks.map((t) => {
    if (!t.enabled) return t.nextRunAt === undefined ? t : { ...t, nextRunAt: undefined };
    if (typeof t.nextRunAt === 'number') return t;
    return { ...t, nextRunAt: computeNextRunAt(t.schedule, now) };
  });
}

/** Advance a task past a run that just happened at `now`. */
export function markRan(task: ScheduledTask, now: number): ScheduledTask {
  return { ...task, lastRunAt: now, nextRunAt: computeNextRunAt(task.schedule, now) };
}

export function loadScheduledTasks(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(SCHEDULED_TASKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ScheduledTask[]) : [];
  } catch {
    return [];
  }
}

export function saveScheduledTasks(tasks: readonly ScheduledTask[]): void {
  localStorage.setItem(SCHEDULED_TASKS_KEY, JSON.stringify(tasks));
}

export function formatSchedule(schedule: string): string {
  const preset = SCHEDULE_PRESETS.find((p) => p.value === schedule);
  if (preset && preset.value !== 'custom') return preset.label;
  const n = intervalMinutes(schedule);
  return n ? `Every ${n} minutes` : schedule;
}
