import { decodeFlashcard, listOf, parseStored } from '@/lib/decode';
import { uid } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CardDifficulty = 1 | 2 | 3; // 1 = easy, 2 = medium, 3 = hard

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  difficulty: CardDifficulty;
  // SM-2 spaced-repetition state
  interval:     number;   // days until next review
  easeFactor:   number;   // starts at 2.5; adjusts with performance
  nextReview:   string;   // YYYY-MM-DD
  reviewCount:  number;
  correctCount: number;
  lastReviewed?: string;  // ISO timestamp
}

export interface ReviewResult {
  cardId:  string;
  correct: boolean;
  /** SM-2 quality: 5 = perfect, 3 = correct w/ difficulty, 1 = incorrect */
  grade:   1 | 3 | 5;
}

export interface DeckStats {
  total:    number;
  due:      number;
  mastered: number; // interval >= 21 days
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sahurlock.flashcards';

export function loadCards(): Flashcard[] {
  if (typeof window === 'undefined') return [];
  return listOf(parseStored(localStorage.getItem(STORAGE_KEY)), decodeFlashcard);
}

export function saveCards(cards: Flashcard[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cards)); } catch {}
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createCard(
  front: string,
  back: string,
  difficulty: CardDifficulty = 2,
): Flashcard {
  const today = todayStr();
  return {
    id: uid(),
    front: front.trim(),
    back: back.trim(),
    difficulty,
    interval:     1,
    easeFactor:   2.5,
    nextReview:   today,
    reviewCount:  0,
    correctCount: 0,
  };
}

export function upsertCard(cards: Flashcard[], card: Flashcard): Flashcard[] {
  const idx = cards.findIndex((c) => c.id === card.id);
  return idx === -1 ? [...cards, card] : cards.map((c, i) => (i === idx ? card : c));
}

export function deleteCard(cards: Flashcard[], id: string): Flashcard[] {
  return cards.filter((c) => c.id !== id);
}

// ── Spaced repetition — SM-2 (simplified) ────────────────────────────────────

/**
 * Update a card's interval and ease factor after a review.
 *
 * grade 5 = perfect recall
 * grade 3 = correct with difficulty
 * grade 1 = incorrect / complete miss
 */
export function applyReview(card: Flashcard, grade: 1 | 3 | 5): Flashcard {
  const now     = new Date();
  const correct = grade >= 3;

  let { interval, easeFactor, reviewCount } = card;

  if (correct) {
    if (reviewCount === 0)      interval = 1;
    else if (reviewCount === 1) interval = 6;
    else                        interval = Math.round(interval * easeFactor);

    // SM-2 ease factor update (clamp above 1.3)
    easeFactor = Math.max(
      1.3,
      easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02),
    );
  } else {
    interval   = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  }

  const nextReview = new Date(now.getTime() + interval * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return {
    ...card,
    interval,
    easeFactor:   round2(easeFactor),
    nextReview,
    reviewCount:  reviewCount + 1,
    correctCount: card.correctCount + (correct ? 1 : 0),
    lastReviewed: now.toISOString(),
  };
}

// ── Session card selection ────────────────────────────────────────────────────

/**
 * Pick cards to show during a break.
 *
 * Selection adapts to current focus performance:
 *   score < 60  → easier cards and recently missed ones first
 *   score 60–80 → balanced mix of due cards
 *   score > 80  → harder / new / long-interval cards first
 */
export function selectSessionCards(
  cards: Flashcard[],
  focusScore: number,
  count = 3,
): Flashcard[] {
  if (cards.length === 0) return [];

  const today = todayStr();
  const due   = cards.filter((c) => c.nextReview <= today);
  // Pad with non-due cards if not enough due cards
  const pool  = due.length >= count
    ? due
    : [...due, ...cards.filter((c) => c.nextReview > today)];

  let sorted: Flashcard[];

  if (focusScore < 60) {
    // Struggling — surface easy + recently missed cards
    sorted = [...pool].sort((a, b) => {
      const diff    = a.difficulty - b.difficulty;         // lower first
      const correct = accuracyOf(b) - accuracyOf(a);      // lower accuracy first
      return diff + correct;
    });
  } else if (focusScore >= 80) {
    // Performing well — challenge with hard / long-interval cards
    sorted = [...pool].sort((a, b) =>
      b.difficulty - a.difficulty || b.interval - a.interval,
    );
  } else {
    // Middle ground — shuffle with slight bias toward due
    sorted = [...pool].sort((a, b) => {
      const aDue = a.nextReview <= today ? 0 : 1;
      const bDue = b.nextReview <= today ? 0 : 1;
      return aDue - bDue || Math.random() - 0.5;
    });
  }

  return sorted.slice(0, count);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getDeckStats(cards: Flashcard[]): DeckStats {
  const today = todayStr();
  return {
    total:    cards.length,
    due:      cards.filter((c) => c.nextReview <= today).length,
    mastered: cards.filter((c) => c.interval >= 21).length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function accuracyOf(c: Flashcard) {
  return c.reviewCount === 0 ? 1 : c.correctCount / c.reviewCount;
}
