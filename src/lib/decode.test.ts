import { describe, expect, it } from 'vitest';
import {
  decodeAggregate, decodeConfig, decodeFlashcard, decodeHistoryItem, decodeNote,
  decodeScheduledSession, decodeTask, decodeTemplate, listOf, parseStored,
} from '@/lib/decode';
import { DEFAULT_CONFIG } from '@/lib/defaults';

describe('parseStored', () => {
  it('returns undefined for a missing key or broken JSON', () => {
    expect(parseStored(null)).toBeUndefined();
    expect(parseStored('{broken')).toBeUndefined();
    expect(parseStored('[1]')).toEqual([1]);
  });
});

describe('listOf', () => {
  it('turns anything that is not an array into an empty list', () => {
    for (const value of [undefined, null, 3, 'x', { a: 1 }]) expect(listOf(value, decodeTask)).toEqual([]);
  });

  it('drops bad items and keeps the good ones', () => {
    const tasks = listOf([null, 7, { id: 't1' }, { id: 't2', title: 'Read' }], decodeTask);
    expect(tasks.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('decodeConfig', () => {
  it('keeps well-typed fields and falls back to defaults for the rest', () => {
    const config = decodeConfig({ durationMinutes: 50, breakLimit: '3', punishmentEnabled: 'yes', extra: 1 }, DEFAULT_CONFIG);
    expect(config).toEqual({ ...DEFAULT_CONFIG, durationMinutes: 50 });
  });

  it('rejects non-finite numbers', () => {
    expect(decodeConfig({ durationMinutes: Number.NaN }, DEFAULT_CONFIG).durationMinutes).toBe(DEFAULT_CONFIG.durationMinutes);
  });

  it('gives the defaults for a value of the wrong shape', () => {
    expect(decodeConfig([1], DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });
});

describe('decodeHistoryItem', () => {
  it('needs an id and a start time, and fills the counters', () => {
    expect(decodeHistoryItem({ id: 's1', stats: {} }, DEFAULT_CONFIG)).toBeUndefined();
    const item = decodeHistoryItem({ id: 's1', stats: { startedAt: '2026-10-23T00:00:00Z', focusScore: 80 } }, DEFAULT_CONFIG);
    expect(item?.config).toEqual(DEFAULT_CONFIG);
    expect(item?.stats).toMatchObject({ focusScore: 80, totalFocusedMs: 0, violationCount: 0, breakUsed: 0 });
  });

  it('keeps only numbers in recovery times', () => {
    const item = decodeHistoryItem({ id: 's1', stats: { startedAt: 'x', recoveryTimes: [1, 'a', null, 2] } }, DEFAULT_CONFIG);
    expect(item?.stats.recoveryTimes).toEqual([1, 2]);
  });
});

describe('decodeAggregate', () => {
  it('repairs each field on its own', () => {
    const defaults = { sessions: 0, totalFocusedMs: 0, totalViolations: 0, totalBreakTimeMs: 0, longestDistractionMs: 0, currentStreak: 0, longestStreak: 0, lastSessionDate: '', totalFocusScore: 0 };
    expect(decodeAggregate({ sessions: 4, currentStreak: 'two' }, defaults)).toEqual({ ...defaults, sessions: 4 });
    expect(decodeAggregate([], defaults)).toEqual(defaults);
  });
});

describe('item decoders', () => {
  it('give missing fields their defaults', () => {
    expect(decodeTask({ id: 't', title: 'Read', status: 'weird' })).toMatchObject({ status: 'active', sessionCount: 0 });
    expect(decodeNote({ id: 'n', createdAt: '2026-10-01T00:00:00Z' })).toEqual({
      id: 'n', title: '', body: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    });
    expect(decodeFlashcard({ id: 'c', front: 'Q', back: 'A', difficulty: 9 })).toMatchObject({ difficulty: 2, interval: 1, easeFactor: 2.5 });
    expect(decodeScheduledSession({ id: 'p', scheduledAt: '2026-10-24T09:00' })).toMatchObject({ fired: false, durationMinutes: 25 });
    expect(decodeTemplate({ id: 'x', name: 'Deep', config: { durationMinutes: '90', breakLimit: 1 } })).toEqual({
      id: 'x', name: 'Deep', description: '', config: { breakLimit: 1 },
    });
  });

  it('drop records without their identity', () => {
    expect(decodeNote({ title: 'no id' })).toBeUndefined();
    expect(decodeFlashcard({ id: 'c', front: 'Q' })).toBeUndefined();
    expect(decodeScheduledSession({ id: 'p' })).toBeUndefined();
    expect(decodeTemplate({ id: 'x' })).toBeUndefined();
  });
});
