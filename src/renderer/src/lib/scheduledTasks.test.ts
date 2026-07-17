import assert from 'node:assert/strict';
import {
  DAILY_RUN_HOUR,
  computeNextRunAt,
  dueTasks,
  intervalMinutes,
  markRan,
  seedNextRunAt,
  formatSchedule,
  type ScheduledTask
} from './scheduledTasks';

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'a',
  name: 'n',
  prompt: 'p',
  schedule: '60',
  providerId: 'prov',
  model: 'm',
  enabled: true,
  ...over
});

// Local-time helper — these presets are defined in the user's local zone.
const at = (y: number, mo: number, d: number, h: number, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

// ─── intervalMinutes ────────────────────────────────────────────────────────

assert.equal(intervalMinutes('60'), 60);
assert.equal(intervalMinutes('360'), 360);
assert.equal(intervalMinutes('daily'), null);
assert.equal(intervalMinutes('weekly-mon'), null);
// Non-positive / nonsense intervals are not intervals
assert.equal(intervalMinutes('0'), null);
assert.equal(intervalMinutes('-5'), null);
assert.equal(intervalMinutes(''), null);

// ─── computeNextRunAt: intervals ────────────────────────────────────────────

{
  const from = at(2026, 7, 17, 10, 0);
  assert.equal(computeNextRunAt('60', from), from + 60 * 60_000);
  assert.equal(computeNextRunAt('360', from), from + 6 * 60 * 60_000);
}

// ─── computeNextRunAt: daily ────────────────────────────────────────────────

// Before today's slot → today
assert.equal(
  computeNextRunAt('daily', at(2026, 7, 17, 8, 0)),
  at(2026, 7, 17, DAILY_RUN_HOUR)
);
// After today's slot → tomorrow (a missed window does not fire immediately)
assert.equal(
  computeNextRunAt('daily', at(2026, 7, 17, 10, 0)),
  at(2026, 7, 18, DAILY_RUN_HOUR)
);
// Exactly at the slot → strictly after, so tomorrow (never returns `from`)
assert.equal(
  computeNextRunAt('daily', at(2026, 7, 17, DAILY_RUN_HOUR)),
  at(2026, 7, 18, DAILY_RUN_HOUR)
);

// ─── computeNextRunAt: weekdays ─────────────────────────────────────────────

// 2026-07-17 is a Friday. After Friday's slot → skips the weekend to Monday.
assert.equal(
  computeNextRunAt('weekdays', at(2026, 7, 17, 10, 0)),
  at(2026, 7, 20, DAILY_RUN_HOUR)
);
// Saturday → Monday
assert.equal(
  computeNextRunAt('weekdays', at(2026, 7, 18, 8, 0)),
  at(2026, 7, 20, DAILY_RUN_HOUR)
);
// Thursday before the slot → same day
assert.equal(
  computeNextRunAt('weekdays', at(2026, 7, 16, 8, 0)),
  at(2026, 7, 16, DAILY_RUN_HOUR)
);

// ─── computeNextRunAt: weekly-mon ───────────────────────────────────────────

// Monday before the slot → today
assert.equal(
  computeNextRunAt('weekly-mon', at(2026, 7, 20, 8, 0)),
  at(2026, 7, 20, DAILY_RUN_HOUR)
);
// Monday after the slot → next Monday, not Tuesday
assert.equal(
  computeNextRunAt('weekly-mon', at(2026, 7, 20, 10, 0)),
  at(2026, 7, 27, DAILY_RUN_HOUR)
);
// Friday → the coming Monday
assert.equal(
  computeNextRunAt('weekly-mon', at(2026, 7, 17, 10, 0)),
  at(2026, 7, 20, DAILY_RUN_HOUR)
);

// Every schedule always advances strictly into the future
for (const s of ['60', '360', 'daily', 'weekdays', 'weekly-mon', 'bogus']) {
  const from = at(2026, 7, 17, DAILY_RUN_HOUR);
  assert.ok(computeNextRunAt(s, from) > from, `${s} must advance past 'from'`);
}

// ─── dueTasks ───────────────────────────────────────────────────────────────

{
  const now = at(2026, 7, 17, 12, 0);
  const ready = task({ id: 'ready', nextRunAt: now - 1 });
  const exact = task({ id: 'exact', nextRunAt: now });
  const later = task({ id: 'later', nextRunAt: now + 1 });
  const paused = task({ id: 'paused', enabled: false, nextRunAt: now - 1 });
  const unscheduled = task({ id: 'unscheduled', nextRunAt: undefined });

  assert.deepEqual(
    dueTasks([ready, exact, later, paused, unscheduled], now).map((t) => t.id),
    ['ready', 'exact']
  );
  // An unscheduled task must never be treated as due — that would fire every
  // task at once the first time the app opened.
  assert.deepEqual(dueTasks([unscheduled], now), []);
  // A disabled task never runs, however overdue.
  assert.deepEqual(dueTasks([paused], now), []);
}

// ─── seedNextRunAt ──────────────────────────────────────────────────────────

{
  const now = at(2026, 7, 17, 12, 0);
  const seeded = seedNextRunAt([task({ id: 'x', schedule: '60', nextRunAt: undefined })], now);
  assert.equal(seeded[0].nextRunAt, now + 60 * 60_000);
  // Seeding schedules forward, so a freshly seeded task is not instantly due.
  assert.deepEqual(dueTasks(seeded, now), []);

  // An existing pending slot survives (a restart must not delay a due run).
  const pending = task({ id: 'y', nextRunAt: now - 5 });
  assert.equal(seedNextRunAt([pending], now)[0].nextRunAt, now - 5);

  // Disabled tasks are unscheduled.
  const off = task({ id: 'z', enabled: false, nextRunAt: now + 10 });
  assert.equal(seedNextRunAt([off], now)[0].nextRunAt, undefined);
}

// ─── markRan ────────────────────────────────────────────────────────────────

{
  const now = at(2026, 7, 17, 12, 0);
  const ran = markRan(task({ schedule: '60', nextRunAt: now - 1 }), now);
  assert.equal(ran.lastRunAt, now);
  assert.equal(ran.nextRunAt, now + 60 * 60_000);
  // Claiming clears the due state, so the next tick won't re-run it.
  assert.deepEqual(dueTasks([ran], now), []);
}

// ─── formatSchedule ─────────────────────────────────────────────────────────

assert.equal(formatSchedule('60'), 'Every hour');
assert.equal(formatSchedule('daily'), 'Daily');
assert.equal(formatSchedule('weekly-mon'), 'Weekly (Mon)');
assert.equal(formatSchedule('45'), 'Every 45 minutes');

console.log('scheduledTasks.test.ts — all assertions passed');
