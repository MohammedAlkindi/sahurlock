import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyReview, getDeckStats, selectSessionCards, type Flashcard } from '@/lib/flashcards';

const NOW = new Date('2026-10-23T12:00:00.000Z');

const card = (overrides: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1',
  front: 'front',
  back: 'back',
  difficulty: 2,
  interval: 0,
  easeFactor: 2.5,
  nextReview: '2026-10-23',
  reviewCount: 0,
  correctCount: 0,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyReview', () => {
  it('schedules a first correct answer for tomorrow', () => {
    const next = applyReview(card(), 5);
    expect(next.interval).toBe(1);
    expect(next.nextReview).toBe('2026-10-24');
    expect(next.reviewCount).toBe(1);
    expect(next.correctCount).toBe(1);
    expect(next.lastReviewed).toBe(NOW.toISOString());
  });

  it('uses six days for the second correct answer', () => {
    expect(applyReview(card({ reviewCount: 1, interval: 1 }), 5).interval).toBe(6);
  });

  it('multiplies the interval by the ease factor after that', () => {
    const next = applyReview(card({ reviewCount: 2, interval: 6, easeFactor: 2.5 }), 5);
    expect(next.interval).toBe(15);
    expect(next.easeFactor).toBe(2.6);
  });

  it('lowers the ease factor for a hard but correct answer', () => {
    // SM-2: 2.5 + 0.1 - 2 * (0.08 + 2 * 0.02) = 2.36
    expect(applyReview(card(), 3).easeFactor).toBe(2.36);
  });

  it('resets the interval and cuts the ease factor on a miss', () => {
    const next = applyReview(card({ reviewCount: 4, interval: 30, easeFactor: 2.5, correctCount: 4 }), 1);
    expect(next.interval).toBe(1);
    expect(next.easeFactor).toBe(2.3);
    expect(next.correctCount).toBe(4);
    expect(next.reviewCount).toBe(5);
  });

  it('never lets the ease factor fall below 1.3', () => {
    expect(applyReview(card({ easeFactor: 1.35 }), 1).easeFactor).toBe(1.3);
  });

  it('does not mutate the card it is given', () => {
    const original = card();
    applyReview(original, 5);
    expect(original.reviewCount).toBe(0);
  });
});

describe('getDeckStats', () => {
  it('counts due and mastered cards', () => {
    const cards = [
      card({ id: 'due', nextReview: '2026-10-22' }),
      card({ id: 'today', nextReview: '2026-10-23' }),
      card({ id: 'later', nextReview: '2026-11-30', interval: 21 }),
    ];
    expect(getDeckStats(cards)).toEqual({ total: 3, due: 2, mastered: 1 });
  });
});

describe('selectSessionCards', () => {
  it('returns nothing for an empty deck', () => {
    expect(selectSessionCards([], 70)).toEqual([]);
  });

  it('pads with cards that are not due yet when too few are due', () => {
    const cards = [
      card({ id: 'due', nextReview: '2026-10-20' }),
      card({ id: 'later', nextReview: '2026-12-01' }),
    ];
    const picked = selectSessionCards(cards, 70, 3);
    expect(picked.map((c) => c.id).sort()).toEqual(['due', 'later']);
  });

  it('puts the hardest, longest-interval cards first for a strong session', () => {
    const cards = [
      card({ id: 'easy', difficulty: 1, nextReview: '2026-10-20' }),
      card({ id: 'hard-short', difficulty: 3, interval: 2, nextReview: '2026-10-20' }),
      card({ id: 'hard-long', difficulty: 3, interval: 9, nextReview: '2026-10-20' }),
    ];
    expect(selectSessionCards(cards, 90, 2).map((c) => c.id)).toEqual(['hard-long', 'hard-short']);
  });

  it('puts the easiest cards first for a weak session', () => {
    const cards = [
      card({ id: 'hard', difficulty: 3, nextReview: '2026-10-20' }),
      card({ id: 'easy', difficulty: 1, nextReview: '2026-10-20' }),
    ];
    expect(selectSessionCards(cards, 40, 1).map((c) => c.id)).toEqual(['easy']);
  });
});
