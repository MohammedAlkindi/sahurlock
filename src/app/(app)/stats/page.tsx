'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2, ChevronDown, TrendingUp, TrendingDown, Minus, Download } from 'lucide-react';
import {
  clearAllData,
  deleteSessionById,
  loadAggregate,
  loadHistory,
  loadTasks,
} from '@/lib/storage';
import { AggregateStats, SessionHistoryItem, Task } from '@/lib/types';
import { formatFocusTime, formatTime, getFocusGrade } from '@/lib/utils';
import { computeDetailedScore } from '@/lib/focus-score';
import { ScoreBreakdownPanel } from '@/components/score-breakdown';

// ── helpers ───────────────────────────────────────────────────────────────────

function safeScore(item: SessionHistoryItem): number {
  const s = item.stats.focusScore ?? computeDetailedScore(item.stats, item.config).total;
  return Number.isNaN(s) ? 0 : s;
}

function dayKey(iso: string) {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ── Streak banner ─────────────────────────────────────────────────────────────

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 60, 100];

function StreakBanner({ agg }: { agg: AggregateStats }) {
  const streak  = agg.currentStreak;
  const longest = agg.longestStreak;
  const doneToday = agg.lastSessionDate === new Date().toDateString();

  const nextMilestone = STREAK_MILESTONES.find((m) => m > streak) ?? null;
  const prevMilestone = [...STREAK_MILESTONES].reverse().find((m) => m <= streak) ?? 0;
  const progressPct   = nextMilestone
    ? Math.round(((streak - prevMilestone) / (nextMilestone - prevMilestone)) * 100)
    : 100;

  const bannerClass = streak === 0
    ? 'border-border bg-card'
    : doneToday
      ? 'border-orange-200 bg-gradient-to-r from-orange-50/60 to-amber-50/40 dark:border-orange-900/40 dark:from-orange-950/20 dark:to-amber-950/10'
      : 'border-yellow-200/80 bg-yellow-50/40 dark:border-yellow-900/40 dark:bg-yellow-950/10';

  return (
    <div className={`mb-5 rounded-2xl border p-5 ${bannerClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className={`text-5xl leading-none select-none ${streak === 0 ? 'grayscale opacity-25' : ''}`}>🔥</span>
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-black tabular-nums ${streak > 0 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                {streak}
              </span>
              <span className="text-base font-semibold text-muted-foreground">day streak</span>
            </div>
            {longest > 0 && (
              <p className="text-[11px] text-muted-foreground/50">Best: {longest} days</p>
            )}
          </div>
        </div>

        {streak > 0 && (
          doneToday ? (
            <span className="shrink-0 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-400">
              Locked in today ✓
            </span>
          ) : (
            <span className="shrink-0 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-400">
              At risk — no session today
            </span>
          )
        )}
      </div>

      {/* Progress to next milestone */}
      {nextMilestone !== null && streak > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground/50">
            <span>{streak}d</span>
            <span>{nextMilestone - streak} day{nextMilestone - streak !== 1 ? 's' : ''} to {nextMilestone}d milestone</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Milestone badges */}
      <div className="mt-4 flex flex-wrap gap-2">
        {STREAK_MILESTONES.map((m) => {
          const active   = streak >= m;
          const achieved = longest >= m;
          return (
            <div
              key={m}
              title={`${m}-day milestone`}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${
                active
                  ? 'bg-orange-500 text-white shadow-sm'
                  : achieved
                    ? 'bg-orange-100 text-orange-500 dark:bg-orange-950/40 dark:text-orange-400'
                    : 'bg-muted/50 text-muted-foreground/30'
              }`}
            >
              {m}d
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-black tabular-nums ${accent ?? 'text-foreground'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color     = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex flex-col items-center gap-1" title={`${label}: ${score}`}>
      <span className={`text-[10px] font-bold tabular-nums ${textColor}`}>{score}</span>
      <div className="relative w-7 overflow-hidden rounded-sm bg-muted" style={{ height: 72 }}>
        <div className={`absolute bottom-0 w-full rounded-sm ${color}`} style={{ height: `${Math.max(2, score)}%` }} />
      </div>
      <span className="w-7 overflow-hidden truncate text-center text-[9px] text-muted-foreground/60">{label}</span>
    </div>
  );
}

// ── Weekly report ─────────────────────────────────────────────────────────────

function WeeklyReport({ history, tasks }: { history: SessionHistoryItem[]; tasks: Task[] }) {
  const now   = new Date();
  const d7    = new Date(now); d7.setDate(d7.getDate() - 7);
  const d14   = new Date(now); d14.setDate(d14.getDate() - 14);

  const thisWeek = history.filter((h) => h.stats.startedAt && new Date(h.stats.startedAt) >= d7);
  const lastWeek = history.filter((h) => {
    const d = h.stats.startedAt ? new Date(h.stats.startedAt) : null;
    return d && d >= d14 && d < d7;
  });

  if (thisWeek.length === 0) return null;

  const sumMs   = (items: SessionHistoryItem[]) => items.reduce((a, b) => a + b.stats.totalFocusedMs, 0);
  const avgScoreOf = (items: SessionHistoryItem[]) =>
    items.length ? Math.round(items.reduce((a, b) => a + safeScore(b), 0) / items.length) : 0;

  const thisFocusMs  = sumMs(thisWeek);
  const lastFocusMs  = sumMs(lastWeek);
  const thisAvgScore = avgScoreOf(thisWeek);
  const lastAvgScore = avgScoreOf(lastWeek);
  const bestSession  = thisWeek.reduce<SessionHistoryItem | null>((best, item) =>
    !best || safeScore(item) > safeScore(best) ? item : best, null);

  const focusDelta = lastFocusMs > 0
    ? Math.round(((thisFocusMs - lastFocusMs) / lastFocusMs) * 100)
    : null;
  const scoreDelta = lastWeek.length > 0 ? thisAvgScore - lastAvgScore : null;

  const completedThisWeek = tasks.filter(
    (t) => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= d7
  ).length;

  const TrendIcon = ({ delta }: { delta: number | null }) => {
    if (delta === null) return <Minus size={12} className="text-muted-foreground/40" />;
    if (delta > 0)  return <TrendingUp  size={12} className="text-green-600" />;
    if (delta < 0)  return <TrendingDown size={12} className="text-red-600" />;
    return <Minus size={12} className="text-muted-foreground/40" />;
  };

  return (
    <div className="mb-5 rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">This week</h2>
        <span className="text-[11px] text-muted-foreground/50">
          {d7.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
          {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Sessions */}
        <div className="rounded-xl bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sessions</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{thisWeek.length}</p>
          {lastWeek.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
              <TrendIcon delta={thisWeek.length - lastWeek.length} />
              vs {lastWeek.length} last week
            </p>
          )}
        </div>

        {/* Focus time */}
        <div className="rounded-xl bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Focus time</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-green-600">{formatFocusTime(thisFocusMs)}</p>
          {focusDelta !== null && (
            <p className={`mt-0.5 flex items-center gap-1 text-[10px] ${focusDelta >= 0 ? 'text-green-500/60' : 'text-red-500/60'}`}>
              <TrendIcon delta={focusDelta} />
              {focusDelta >= 0 ? '+' : ''}{focusDelta}% vs last week
            </p>
          )}
        </div>

        {/* Avg score */}
        <div className="rounded-xl bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Avg score</p>
          <p className={`mt-1 text-2xl font-black tabular-nums ${getFocusGrade(thisAvgScore).color}`}>{thisAvgScore}</p>
          {scoreDelta !== null && (
            <p className={`mt-0.5 flex items-center gap-1 text-[10px] ${scoreDelta >= 0 ? 'text-green-500/60' : 'text-red-500/60'}`}>
              <TrendIcon delta={scoreDelta} />
              {scoreDelta >= 0 ? '+' : ''}{scoreDelta} pts vs last week
            </p>
          )}
        </div>

        {/* Tasks / best session */}
        <div className="rounded-xl bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tasks done</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-accent">{completedThisWeek}</p>
          {bestSession && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/50">
              Best: <span className={getFocusGrade(safeScore(bestSession)).color}>{safeScore(bestSession)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Focus heatmap ─────────────────────────────────────────────────────────────

function FocusHeatmap({ history }: { history: SessionHistoryItem[] }) {
  const WEEKS = 16;
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Build a map: YYYY-MM-DD → avg score
  const scoreByDay = new Map<string, number[]>();
  for (const item of history) {
    if (!item.stats.startedAt) continue;
    const key = dayKey(item.stats.startedAt);
    const scores = scoreByDay.get(key) ?? [];
    scores.push(safeScore(item));
    scoreByDay.set(key, scores);
  }

  // Build grid: columns = weeks (oldest → newest), rows = Mon–Sun
  const cells: { date: Date; score: number | null }[][] = [];
  // Find the Monday of the week WEEKS weeks ago
  const startDate = addDays(today, -(WEEKS * 7 - 1));
  // Align to Monday
  const dow = startDate.getDay(); // 0=Sun
  const aligned = addDays(startDate, dow === 0 ? -6 : 1 - dow);

  for (let w = 0; w < WEEKS; w++) {
    const col: { date: Date; score: number | null }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(aligned, w * 7 + d);
      const key  = dayKey(date.toISOString());
      const vals = scoreByDay.get(key);
      const score = vals ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      col.push({ date, score });
    }
    cells.push(col);
  }

  const cellColor = (score: number | null) => {
    if (score === null) return 'bg-muted/40';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const cellOpacity = (score: number | null) => {
    if (score === null) return '';
    if (score >= 80) return score >= 90 ? 'opacity-100' : 'opacity-70';
    if (score >= 60) return score >= 70 ? 'opacity-80' : 'opacity-60';
    return 'opacity-60';
  };

  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="mb-5 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Focus history</h2>
        <div className="flex gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-500" />80+</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-yellow-500" />60–79</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500" />&lt;60</span>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {/* Day labels */}
        <div className="flex shrink-0 flex-col justify-around pr-1" style={{ gap: '3px' }}>
          {DAYS.map((d, i) => (
            <span key={i} className="text-[9px] leading-none text-muted-foreground/40" style={{ height: 12 }}>{d}</span>
          ))}
        </div>

        {/* Week columns */}
        {cells.map((week, wi) => (
          <div key={wi} className="flex shrink-0 flex-col" style={{ gap: '3px' }}>
            {week.map(({ date, score }, di) => {
              const isFuture = date > today;
              return (
                <div
                  key={di}
                  title={isFuture ? '' : `${dayKey(date.toISOString())}${score !== null ? ` · ${score}` : ''}`}
                  className={`h-3 w-3 rounded-sm transition-opacity ${
                    isFuture
                      ? 'bg-muted/20'
                      : `${cellColor(score)} ${cellOpacity(score)}`
                  }`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Month labels */}
      <div className="mt-2 flex gap-1.5 pl-7 overflow-x-auto">
        {cells.map((week, wi) => {
          const first = week[0].date;
          const showLabel = first.getDate() <= 7;
          return (
            <div key={wi} className="w-3 shrink-0 text-center">
              {showLabel && (
                <span className="text-[9px] text-muted-foreground/40">
                  {first.toLocaleDateString(undefined, { month: 'short' })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [agg,        setAgg]        = useState<AggregateStats | null>(null);
  const [history,    setHistory]    = useState<SessionHistoryItem[]>([]);
  const [tasks,      setTasks]      = useState<Task[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = () => {
    setAgg(loadAggregate());
    setHistory(loadHistory());
    setTasks(loadTasks());
  };

  useEffect(() => { reload(); }, []);

  if (!agg) return null;

  const hasData   = agg.sessions > 0;
  const rawAvg    = hasData ? agg.totalFocusScore / agg.sessions : 0;
  const avgScore  = Number.isNaN(rawAvg) ? 0 : Math.round(rawAvg);
  const bestScore = history.length ? Math.max(...history.map(safeScore)) : 0;

  const doneTasks  = tasks.filter((t) => t.status === 'done').length;
  const totalTasks = tasks.length;
  const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : null;

  const chartItems = [...history].slice(0, 16).reverse().map((item) => ({
    score: safeScore(item),
    label: item.stats.startedAt
      ? new Date(item.stats.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '—',
    id: item.id,
  }));

  const handleDelete = (id: string) => { deleteSessionById(id); reload(); };
  const handleClearAll = () => { clearAllData(); setConfirming(false); reload(); };

  const handleExport = () => {
    const data = { exportedAt: new Date().toISOString(), aggregate: agg, sessions: history, tasks };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sahurlock-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">

      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-black tracking-tight">Stats</h1>
        <div className="flex items-center gap-2">
          {hasData && (
            confirming ? (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/40 dark:bg-red-950/20">
                <span className="text-xs text-red-700 dark:text-red-400">Delete everything?</span>
                <button onClick={handleClearAll} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 transition">Yes, clear</button>
                <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-accent/40 hover:text-foreground transition"
                >
                  <Download size={12} />Export
                </button>
                <button onClick={() => setConfirming(true)} className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-red-200 hover:text-red-600 transition">
                  Clear data
                </button>
              </div>
            )
          )}
          <Link href="/session" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground hover:opacity-90 transition">
            New Session
          </Link>
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card/50 py-24 text-center">
          <p className="text-base font-semibold text-muted-foreground">No sessions yet</p>
          <Link href="/session" className="mt-2 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 transition">
            Start a session
          </Link>
        </div>
      ) : (
        <>
          {/* Streak banner */}
          <StreakBanner agg={agg} />

          {/* Weekly report */}
          <WeeklyReport history={history} tasks={tasks} />

          {/* Stat cards */}
          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Sessions"   value={String(agg.sessions)} />
            <StatCard label="Focus time" value={formatFocusTime(agg.totalFocusedMs)} accent="text-green-600" />
            <StatCard label="Avg score"  value={String(avgScore)}  accent={getFocusGrade(avgScore).color} />
            <StatCard label="Best score" value={String(bestScore)} accent={getFocusGrade(bestScore).color} />
            <StatCard
              label="Tasks done"
              value={String(doneTasks)}
              sub={completionRate !== null ? `${completionRate}% of ${totalTasks}` : undefined}
              accent={doneTasks > 0 ? 'text-accent' : 'text-muted-foreground'}
            />
          </div>

          {/* Focus heatmap */}
          <FocusHeatmap history={history} />

          {/* Score trend */}
          {chartItems.length > 1 && (
            <div className="mb-5 rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Score trend</h2>
                <div className="flex gap-3 text-[10px] text-muted-foreground/50">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-2.5 rounded bg-green-500/50" />80+</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-2.5 rounded bg-yellow-500/50" />60–79</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-2.5 rounded bg-red-500/50" />&lt;60</span>
                </div>
              </div>
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
                {chartItems.map((s) => <ScoreBar key={s.id} score={s.score} label={s.label} />)}
              </div>
            </div>
          )}

          {/* History table */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold text-foreground">
                History
                <span className="ml-2 text-xs font-normal text-muted-foreground">{history.length} session{history.length !== 1 ? 's' : ''}</span>
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Focus %</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Violations</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Longest lapse</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => {
                    const score      = safeScore(item);
                    const grade      = getFocusGrade(score);
                    const sessionMs  = item.config.durationMinutes * 60_000;
                    const focusPct   = sessionMs > 0 ? Math.round((item.stats.totalFocusedMs / sessionMs) * 100) : 0;
                    const isExpanded = expandedId === item.id;
                    const hasNotes   = !!item.stats.notes?.trim();

                    return (
                      <>
                        <tr
                          key={item.id}
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          className="cursor-pointer border-b border-border/40 transition hover:bg-muted/20"
                        >
                          <td className="px-5 py-3">
                            <p className="text-xs text-muted-foreground">
                              {item.stats.startedAt
                                ? new Date(item.stats.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </p>
                            {item.stats.taskTitle && (
                              <p className="mt-0.5 truncate text-[10px] text-muted-foreground/50">{item.stats.taskTitle}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-foreground">{item.config.durationMinutes} min</td>
                          <td className="px-4 py-3">
                            <span className={`font-bold tabular-nums ${grade.color}`}>{score}</span>
                            <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${grade.bg} ${grade.color}`}>{grade.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <div className={`h-full rounded-full ${focusPct >= 80 ? 'bg-green-500' : focusPct >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${focusPct}%` }} />
                              </div>
                              <span className="tabular-nums text-xs text-muted-foreground">{focusPct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={item.stats.violationCount === 0 ? 'text-green-600' : 'text-foreground'}>
                              {item.stats.violationCount}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                            {item.stats.longestDistractionMs > 0 ? formatTime(item.stats.longestDistractionMs) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <ChevronDown
                                size={13}
                                className={`text-muted-foreground/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                                className="rounded p-1.5 text-muted-foreground/30 transition hover:bg-muted hover:text-red-600"
                                aria-label="Delete session"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${item.id}-detail`} className="border-b border-border/40 bg-muted/10">
                            <td colSpan={7} className="px-5 py-4">
                              <div className="grid gap-4 sm:grid-cols-2">
                                <ScoreBreakdownPanel
                                  breakdown={computeDetailedScore(item.stats, item.config)}
                                  showHeader
                                />
                                {hasNotes && (
                                  <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Notes</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.stats.notes}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {history.length === 30 && (
              <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                Showing last 30 sessions
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
