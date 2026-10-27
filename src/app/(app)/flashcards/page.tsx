'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  CardDifficulty,
  Flashcard,
  createCard,
  deleteCard,
  getDeckStats,
  loadCards,
  saveCards,
  upsertCard,
} from '@/lib/flashcards';

// ── Difficulty selector ────────────────────────────────────────────────────────

const DIFF_OPTIONS: { value: CardDifficulty; label: string; color: string }[] = [
  { value: 1, label: 'Easy',   color: 'border-success/50  text-success  data-active:bg-success/15'  },
  { value: 2, label: 'Medium', color: 'border-warning/50 text-warning data-active:bg-warning/15' },
  { value: 3, label: 'Hard',   color: 'border-danger/50    text-danger    data-active:bg-danger/15'    },
];

function DifficultyPicker({
  value,
  onChange,
}: {
  value: CardDifficulty;
  onChange: (v: CardDifficulty) => void;
}) {
  return (
    <div className="flex gap-1">
      {DIFF_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-active={value === opt.value ? '' : undefined}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-lg border px-3 py-1 text-xs font-medium transition',
            opt.color,
            value === opt.value ? '' : 'opacity-40 hover:opacity-70',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Card form ─────────────────────────────────────────────────────────────────

interface CardFormProps {
  initial?: Flashcard;
  onSave: (front: string, back: string, difficulty: CardDifficulty) => void;
  onCancel?: () => void;
}

function CardForm({ initial, onSave, onCancel }: CardFormProps) {
  const [front, setFront]       = useState(initial?.front ?? '');
  const [back,  setBack]        = useState(initial?.back  ?? '');
  const [diff,  setDiff]        = useState<CardDifficulty>(initial?.difficulty ?? 2);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { frontRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    onSave(front, back, diff);
    if (!initial) { setFront(''); setBack(''); setDiff(2); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        ref={frontRef}
        value={front}
        onChange={(e) => setFront(e.target.value)}
        placeholder="Front — question or term"
        rows={2}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-hidden focus:ring-1 focus:ring-ring"
      />
      <textarea
        value={back}
        onChange={(e) => setBack(e.target.value)}
        placeholder="Back — answer or definition"
        rows={2}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-hidden focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center justify-between">
        <DifficultyPicker value={diff} onChange={setDiff} />
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!front.trim() || !back.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {initial ? 'Save' : 'Add card'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Card row ──────────────────────────────────────────────────────────────────

const DIFF_BADGE: Record<number, string> = {
  1: 'bg-success/10  text-success',
  2: 'bg-warning/10 text-warning',
  3: 'bg-danger/10    text-danger',
};
const DIFF_LABEL: Record<number, string> = { 1: 'Easy', 2: 'Med', 3: 'Hard' };

function CardRow({
  card,
  onEdit,
  onDelete,
}: {
  card: Flashcard;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const today    = new Date().toISOString().slice(0, 10);
  const isDue    = card.nextReview <= today;
  const accuracy = card.reviewCount > 0
    ? Math.round((card.correctCount / card.reviewCount) * 100)
    : null;

  if (editing) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <CardForm
          initial={card}
          onSave={(front, back, difficulty) => {
            onEdit({ ...card, front, back, difficulty });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="group rounded-xl border border-border bg-card p-4 transition hover:border-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug">{card.front}</p>
          <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{card.back}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 transition [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit card"
            className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(card.id)}
            aria-label="Delete card"
            className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-muted hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
        <span className={cn('rounded-sm px-1.5 py-0.5 font-medium', DIFF_BADGE[card.difficulty])}>
          {DIFF_LABEL[card.difficulty]}
        </span>
        {isDue ? (
          <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 font-medium text-warning">Due</span>
        ) : (
          <span className="text-muted-foreground">
            Next {new Date(card.nextReview + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
        {accuracy !== null && (
          <span className={cn('text-muted-foreground', accuracy >= 80 ? 'text-success' : accuracy < 50 ? 'text-danger' : '')}>
            {accuracy}% correct ({card.reviewCount} reviews)
          </span>
        )}
        {card.interval >= 21 && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">Mastered</span>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FlashcardsPage() {
  const [cards,      setCards]      = useState<Flashcard[]>([]);
  const [showForm,   setShowForm]   = useState(false);
  const [filter,     setFilter]     = useState<'all' | 'due' | 'mastered'>('all');

  const reload = () => setCards(loadCards());
  useEffect(() => { reload(); }, []);

  const persist = (next: Flashcard[]) => { saveCards(next); setCards(next); };

  const handleAdd = (front: string, back: string, difficulty: CardDifficulty) => {
    persist(upsertCard(cards, createCard(front, back, difficulty)));
    setShowForm(false);
  };

  const handleEdit = (updated: Flashcard) => {
    persist(upsertCard(cards, updated));
  };

  const handleDelete = (id: string) => {
    persist(deleteCard(cards, id));
  };

  const stats   = getDeckStats(cards);
  const today   = new Date().toISOString().slice(0, 10);

  const visible = cards.filter((c) => {
    if (filter === 'due')      return c.nextReview <= today;
    if (filter === 'mastered') return c.interval >= 21;
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Flashcards</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cards appear during session breaks, adapted to your focus score.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 transition"
        >
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? 'Cancel' : 'New card'}
        </button>
      </div>

      {/* Stats strip */}
      {cards.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            { label: 'Total',    value: stats.total,    accent: '' },
            { label: 'Due today', value: stats.due,     accent: stats.due > 0 ? 'text-warning' : '' },
            { label: 'Mastered', value: stats.mastered, accent: stats.mastered > 0 ? 'text-success' : '' },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={cn('mt-1.5 text-3xl font-black tabular-nums', accent || 'text-foreground')}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add card form */}
      {showForm && (
        <div className="mb-5 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">New card</h2>
          <CardForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Filter tabs */}
      {cards.length > 0 && (
        <div className="mb-4 flex gap-1">
          {(['all', 'due', 'mastered'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition capitalize',
                filter === f
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Card list */}
      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <p className="text-sm font-semibold text-muted-foreground">No cards yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add your first card and it will appear during session breaks.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
          >
            <Plus size={14} />
            Add card
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No cards match this filter.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((card) => (
            <CardRow key={card.id} card={card} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
