import { describe, expect, it } from 'vitest';
import { computeDetailedScore } from '@/lib/focus-score';
import type { SessionConfig, SessionStats } from '@/lib/types';

const config: SessionConfig = {
  durationMinutes: 25,
  offscreenThresholdSec: 10,
  breakLimit: 2,
  breakDurationSec: 60,
  punishmentEnabled: false,
  punishmentMedia: 'sahur',
  pomodoroEnabled: false,
  phoneDetectionEnabled: false,
};

const fullMs = config.durationMinutes * 60_000;

const stats = (overrides: Partial<SessionStats> = {}): SessionStats => ({
  startedAt: '2026-10-23T00:00:00.000Z',
  totalFocusedMs: fullMs,
  violationCount: 0,
  longestDistractionMs: 0,
  breakUsed: 0,
  breakTimeUsedMs: 0,
  recoveryTimes: [],
  focusTransitions: 0,
  ...overrides,
});

describe('computeDetailedScore', () => {
  it('gives a perfect session 100 with every component at its maximum', () => {
    expect(computeDetailedScore(stats(), config)).toEqual({
      focusRatio: 50,
      control: 25,
      recoverySpeed: 15,
      stability: 10,
      total: 100,
    });
  });

  it('returns zeros for a zero-length session instead of dividing by zero', () => {
    const score = computeDetailedScore(stats(), { ...config, durationMinutes: 0 });
    expect(score.total).toBe(0);
    expect(score.focusRatio).toBe(0);
  });

  it('scales the focus component with the share of time focused', () => {
    const score = computeDetailedScore(stats({ totalFocusedMs: fullMs / 2 }), config);
    expect(score.focusRatio).toBe(25);
    expect(score.total).toBe(75);
  });

  it('caps focus time above the session length at 50 points', () => {
    const score = computeDetailedScore(stats({ totalFocusedMs: fullMs * 2 }), config);
    expect(score.focusRatio).toBe(50);
  });

  it('loses 2.5 control points per violation and bottoms out at ten', () => {
    expect(computeDetailedScore(stats({ violationCount: 2, recoveryTimes: [0, 0] }), config).control).toBe(20);
    expect(computeDetailedScore(stats({ violationCount: 15, recoveryTimes: [0] }), config).control).toBe(0);
  });

  it('scores recovery from the average recovery time', () => {
    const score = computeDetailedScore(
      stats({ violationCount: 2, recoveryTimes: [4_000, 6_000] }),
      config,
    );
    expect(score.recoverySpeed).toBe(7.5);
  });

  it('estimates recovery for legacy sessions from the longest distraction', () => {
    const score = computeDetailedScore(
      stats({ violationCount: 1, recoveryTimes: undefined, longestDistractionMs: 4_000 }),
      config,
    );
    // half of 4 s = 2 s average, so 15 * (1 - 0.2) = 12
    expect(score.recoverySpeed).toBe(12);
  });

  it('treats missing transition data as perfectly stable', () => {
    const score = computeDetailedScore(stats({ focusTransitions: undefined }), config);
    expect(score.stability).toBe(10);
  });

  it('loses half a stability point per transition into warning', () => {
    expect(computeDetailedScore(stats({ focusTransitions: 5 }), config).stability).toBe(7.5);
    expect(computeDetailedScore(stats({ focusTransitions: 40 }), config).stability).toBe(0);
  });
});
