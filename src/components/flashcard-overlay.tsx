'use client';

import { useState } from 'react';
import { X, RotateCcw, Check } from 'lucide-react';
import type { Flashcard, ReviewResult } from '@/lib/flashcards';

interface Props {
  cards: Flashcard[];
  /** Current live focus score — shown as context for difficulty label */
  focusScore: number;
  onComplete: (results: ReviewResult[]) => void;
  onDismiss: () => void;
}

type Phase = 'front' | 'back';

const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFFICULTY_COLOR: Record<number, string> = {
  1: 'text-green-700 bg-green-500/10',
  2: 'text-amber-700 bg-amber-500/10',
  3: 'text-red-700 bg-red-500/10',
};

export function FlashcardOverlay({ cards, focusScore, onComplete, onDismiss }: Props) {
  const [idx,     setIdx]     = useState(0);
  const [phase,   setPhase]   = useState<Phase>('front');
  const [results, setResults] = useState<ReviewResult[]>([]);

  if (cards.length === 0) return null;

  const card    = cards[idx];
  const total   = cards.length;
  const isLast  = idx === total - 1;
  const correct = results.filter((r) => r.correct).length;

  const handleReveal = () => setPhase('back');

  const handleGrade = (grade: 1 | 3 | 5) => {
    const result: ReviewResult = { cardId: card.id, correct: grade >= 3, grade };
    const next = [...results, result];
    setResults(next);

    if (isLast) {
      onComplete(next);
    } else {
      setIdx((i) => i + 1);
      setPhase('front');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Break Review
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {idx + 1} / {total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              focusScore >= 80
                ? 'bg-red-500/10 text-red-600'
                : focusScore >= 60
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-green-500/10 text-green-600'
            }`}>
              {focusScore >= 80 ? 'Challenging mix' : focusScore >= 60 ? 'Balanced review' : 'Reinforcing basics'}
            </span>
            <span className="text-[10px] text-muted-foreground/40">{focusScore}</span>
            <button
              onClick={onDismiss}
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Skip all cards"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-border">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((idx + (phase === 'back' ? 0.5 : 0)) / total) * 100}%` }}
          />
        </div>

        {/* Card body */}
        <div className="p-6">
          {/* Difficulty badge */}
          <div className="mb-4 flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${DIFFICULTY_COLOR[card.difficulty]}`}>
              {DIFFICULTY_LABEL[card.difficulty]}
            </span>
            {card.reviewCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                {card.correctCount}/{card.reviewCount} correct
              </span>
            )}
          </div>

          {/* Front */}
          <p className="min-h-[60px] text-base font-medium leading-relaxed text-foreground">
            {card.front}
          </p>

          {/* Back — revealed or hidden */}
          {phase === 'back' ? (
            <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm leading-relaxed text-foreground">{card.back}</p>
            </div>
          ) : (
            <div className="mt-5">
              <button
                onClick={handleReveal}
                className="w-full rounded-xl border border-border bg-muted/30 py-3 text-sm font-medium text-muted-foreground transition hover:border-foreground/20 hover:bg-muted hover:text-foreground"
              >
                Reveal answer
              </button>
            </div>
          )}
        </div>

        {/* Grading buttons — only after reveal */}
        {phase === 'back' && (
          <div className="grid grid-cols-3 gap-2 border-t border-border px-5 py-4">
            <button
              onClick={() => handleGrade(1)}
              className="flex flex-col items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-2 py-2.5 text-xs text-red-700 transition hover:border-red-300 hover:bg-red-100"
            >
              <RotateCcw size={14} />
              <span>Missed</span>
            </button>
            <button
              onClick={() => handleGrade(3)}
              className="flex flex-col items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2.5 text-xs text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
            >
              <Check size={14} />
              <span>Almost</span>
            </button>
            <button
              onClick={() => handleGrade(5)}
              className="flex flex-col items-center gap-1 rounded-xl border border-green-200 bg-green-50 px-2 py-2.5 text-xs text-green-700 transition hover:border-green-300 hover:bg-green-100"
            >
              <Check size={14} strokeWidth={2.5} />
              <span>Got it</span>
            </button>
          </div>
        )}

        {/* Session result summary (shown briefly before onComplete fires) */}
        {isLast && phase === 'back' && (
          <div className="border-t border-border px-5 py-3 text-center text-xs text-muted-foreground">
            {correct + (results.length > results.length ? 0 : 0)} of {total} answered — closing…
          </div>
        )}
      </div>
    </div>
  );
}
