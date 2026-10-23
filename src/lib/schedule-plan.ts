import type { ScheduledSession } from '@/lib/types';

/** setTimeout fires at once for delays above a signed 32-bit millisecond count. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** A reminder missed by more than this is dropped instead of shown late. */
export const MISSED_GRACE_MS = 15 * 60_000;

export interface ReminderPlan {
  /** Due now, or missed within the grace window: notify. */
  fireNow: ScheduledSession[];
  /** Missed long ago: mark as fired without notifying. */
  expire: ScheduledSession[];
  /** Still ahead. `final` is false when the delay was capped and the plan must be rebuilt then. */
  later: { session: ScheduledSession; delayMs: number; final: boolean }[];
}

export function planReminders(sessions: ScheduledSession[], now: number): ReminderPlan {
  const plan: ReminderPlan = { fireNow: [], expire: [], later: [] };
  for (const session of sessions) {
    if (session.fired) continue;
    const due = new Date(session.scheduledAt).getTime();
    if (Number.isNaN(due)) continue;
    const msUntil = due - now;
    if (msUntil <= 0) {
      if (-msUntil <= MISSED_GRACE_MS) plan.fireNow.push(session);
      else plan.expire.push(session);
    } else {
      const delayMs = Math.min(msUntil, MAX_TIMEOUT_MS);
      plan.later.push({ session, delayMs, final: delayMs === msUntil });
    }
  }
  return plan;
}
