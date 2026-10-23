'use client';

import { useEffect, useRef, useState } from 'react';
import { useDialog } from '@/hooks/use-dialog';
import Link from 'next/link';
import { loadAggregate, updateSessionNotes } from '@/lib/storage';
import { AggregateStats, SessionConfig, SessionStats } from '@/lib/types';
import { formatFocusTime, formatTime, getFocusGrade } from '@/lib/utils';
import { computeDetailedScore } from '@/lib/focus-score';
import { ScoreBreakdownPanel } from '@/components/score-breakdown';

interface Props {
  sessionId: string;
  stats: SessionStats;
  config: SessionConfig;
  onReset: () => void;
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-accent' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

export function SessionSummary({ sessionId, stats, config, onReset }: Props) {
  const breakdown       = computeDetailedScore(stats, config);
  const score           = stats.focusScore ?? breakdown.total;
  const grade           = getFocusGrade(score);
  const sessionDurationMs = config.durationMinutes * 60_000;

  const focusPct = sessionDurationMs > 0
    ? Math.round((stats.totalFocusedMs / sessionDurationMs) * 100)
    : 0;

  const [notes, setNotes] = useState(stats.notes ?? '');
  const [agg, setAgg]     = useState<AggregateStats | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onReset);

  useEffect(() => { setAgg(loadAggregate()); }, []);

  const handleNotesChange = (val: string) => {
    setNotes(val);
    updateSessionNotes(sessionId, val);
  };

  const message =
    score >= 90 ? 'Clean session.' :
    score >= 80 ? 'Solid.' :
    score >= 70 ? 'Some drift, but you stayed in it.' :
    score >= 60 ? 'Rough one. Tighten up next time.' :
    'You need to lock in.';

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-summary-title"
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className={`px-6 py-4 ${grade.bg} border-b border-border`}>
          <p id="session-summary-title" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Session Complete</p>
          <p className="mt-1 text-sm text-foreground">{message}</p>
        </div>

        <div className="p-6">
          {/* Score */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Focus Score</p>
              <div className={`text-7xl font-black leading-none ${grade.color}`}>{score}</div>
            </div>
            <div className={`flex h-20 w-20 flex-col items-center justify-center rounded-2xl ring-2 ${grade.ring} ${grade.bg}`}>
              <span className={`text-4xl font-black ${grade.color}`}>{grade.label}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">GRADE</span>
            </div>
          </div>

          {/* Focus bar */}
          <div className="mb-6">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Focus efficiency</span>
              <span className="font-semibold text-foreground">{focusPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-accent" style={{ width: `${focusPct}%` }} />
            </div>
          </div>

          {/* Task */}
          {stats.taskTitle && (
            <div className="mb-4 rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-xs">
              <span className="text-muted-foreground">Working on </span>
              <span className="font-medium text-foreground">{stats.taskTitle}</span>
            </div>
          )}

          {/* Streak */}
          {agg && agg.currentStreak > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-warning">
                🔥 {agg.currentStreak} day streak
              </span>
              {agg.currentStreak > 1 && (
                <span className="text-xs text-warning">
                  {agg.currentStreak === agg.longestStreak ? 'Personal best!' : `Best: ${agg.longestStreak}d`}
                </span>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="mb-4 space-y-2">
            <StatRow label="Focused time"        value={formatFocusTime(stats.totalFocusedMs)} highlight />
            <StatRow label="Total violations"    value={String(stats.violationCount)} />
            {(stats.phoneCheckCount ?? 0) > 0 && (
              <StatRow label="Phone checks" value={String(stats.phoneCheckCount)} />
            )}
            <StatRow label="Longest distraction" value={formatTime(stats.longestDistractionMs)} />
            <StatRow label="Breaks used"         value={`${stats.breakUsed} / ${config.breakLimit}`} />
            {stats.breakUsed > 0 && (
              <StatRow label="Total break time"  value={formatFocusTime(stats.breakTimeUsedMs)} />
            )}
          </div>

          {/* Score breakdown */}
          <details className="mb-4 rounded-xl border border-border bg-muted/30">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              Score breakdown ▸
            </summary>
            <div className="border-t border-border px-4 py-4">
              <ScoreBreakdownPanel breakdown={breakdown} showHeader={false} />
            </div>
          </details>

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Session notes (optional)…"
            rows={2}
            className="mb-4 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-foreground placeholder-muted-foreground focus:border-accent focus:outline-none"
          />

          <button
            onClick={onReset}
            className="w-full rounded-xl bg-accent px-4 py-3 font-bold text-accent-foreground transition hover:bg-accent/90"
          >
            Start New Session
          </button>
          <Link
            href="/stats"
            className="mt-2 block w-full rounded-xl border border-border px-4 py-3 text-center text-sm font-semibold text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
          >
            View Stats
          </Link>
        </div>
      </div>
    </div>
  );
}
