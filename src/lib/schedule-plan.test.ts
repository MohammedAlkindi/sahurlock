import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_MS, MISSED_GRACE_MS, planReminders } from '@/lib/schedule-plan';
import type { ScheduledSession } from '@/lib/types';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');

const session = (id: string, offsetMs: number, fired = false): ScheduledSession => ({
  id,
  label: id,
  scheduledAt: new Date(NOW + offsetMs).toISOString(),
  durationMinutes: 25,
  fired,
});

describe('planReminders', () => {
  it('schedules an upcoming reminder for its exact delay', () => {
    const plan = planReminders([session('soon', 60_000)], NOW);
    expect(plan.later).toEqual([{ session: session('soon', 60_000), delayMs: 60_000, final: true }]);
    expect(plan.fireNow).toEqual([]);
  });

  it('caps a delay beyond the setTimeout limit and asks to re-plan', () => {
    const far = session('far', MAX_TIMEOUT_MS + 1_000);
    const [entry] = planReminders([far], NOW).later;
    expect(entry.delayMs).toBe(MAX_TIMEOUT_MS);
    expect(entry.final).toBe(false);
  });

  it('fires a reminder that is due or only just missed', () => {
    const plan = planReminders([session('now', 0), session('late', -MISSED_GRACE_MS)], NOW);
    expect(plan.fireNow.map((s) => s.id)).toEqual(['now', 'late']);
  });

  it('expires a reminder missed long ago instead of showing it late', () => {
    const plan = planReminders([session('stale', -MISSED_GRACE_MS - 1)], NOW);
    expect(plan.expire.map((s) => s.id)).toEqual(['stale']);
    expect(plan.fireNow).toEqual([]);
  });

  it('ignores fired reminders and unreadable dates', () => {
    const broken = { ...session('broken', 60_000), scheduledAt: 'not a date' };
    const plan = planReminders([session('done', 60_000, true), broken], NOW);
    expect(plan).toEqual({ fireNow: [], expire: [], later: [] });
  });
});
