import { useEffect, useRef } from 'react';
import {
  dueTasks,
  loadScheduledTasks,
  markRan,
  saveScheduledTasks,
  seedNextRunAt,
  SCHEDULED_TASKS_KEY,
  type ScheduledTask
} from '../lib/scheduledTasks';

const TICK_MS = 30_000;

/**
 * Runs due scheduled tasks while the app is open.
 *
 * Mount this exactly once, at the app root — not in the settings panel, which
 * only exists while that tab is open. Tasks only fire while DERO Hive is
 * running; there is no background daemon, and a window that was closed over a
 * task's slot rolls that task forward rather than firing on next launch.
 */
export function useScheduledTasks(): void {
  // Guards against a tick landing while the previous one is still sending.
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Schedule any task that has no nextRunAt yet (newly created, or created
    // before the scheduler existed) forward from now.
    const seeded = seedNextRunAt(loadScheduledTasks(), Date.now());
    saveScheduledTasks(seeded);

    const tick = async (): Promise<void> => {
      if (cancelled || running.current) return;
      const now = Date.now();
      // Re-read every tick: the settings panel writes through localStorage.
      const tasks = loadScheduledTasks();
      const due = dueTasks(tasks, now);
      if (due.length === 0) return;

      running.current = true;
      try {
        // Claim the due tasks — recording lastRunAt and the next slot — before
        // awaiting anything, so a slow send can't let the next tick fire the
        // same task twice. A run that then fails stays claimed and retries at
        // its next slot rather than hammering a broken provider every tick.
        const claimed: ScheduledTask[] = tasks.map((t) =>
          due.some((d) => d.id === t.id) ? markRan(t, now) : t
        );
        saveScheduledTasks(claimed);

        for (const task of due) {
          if (cancelled) return;
          try {
            const conv = await window.hive.convCreate({
              title: `Scheduled: ${task.name}`,
              projectId: task.projectId
            });
            await window.hive.chatSend({
              conversationId: conv.id,
              providerId: task.providerId,
              model: task.model,
              messages: [
                { id: crypto.randomUUID(), role: 'user', content: task.prompt, createdAt: Date.now() }
              ]
            });
          } catch {
            // Already claimed above — swallow so one bad task doesn't stop the rest.
          }
        }
      } finally {
        running.current = false;
      }
    };

    const id = setInterval(() => void tick(), TICK_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Keep the in-memory guard honest if another window clears storage.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SCHEDULED_TASKS_KEY && e.newValue === null) running.current = false;
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
