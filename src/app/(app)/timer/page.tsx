'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Flag } from 'lucide-react';
import { cn } from '@/lib/cn';

// ── helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatMs(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h  = Math.floor(totalSec / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function formatCountdown(ms: number) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Stopwatch ─────────────────────────────────────────────────────────────────

function Stopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps,    setLaps]    = useState<number[]>([]);
  const startRef = useRef(0);
  const baseRef  = useRef(0);
  const rafRef   = useRef(0);

  const tick = useCallback(() => {
    setElapsed(baseRef.current + (performance.now() - startRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = () => {
    startRef.current = performance.now();
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    cancelAnimationFrame(rafRef.current);
    baseRef.current += performance.now() - startRef.current;
    setRunning(false);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setElapsed(0);
    setLaps([]);
    baseRef.current = 0;
  };

  const lap = () => setLaps((prev) => [elapsed, ...prev]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const lastLapStart = laps.length > 0 ? laps[0] : 0;
  const currentLapMs = elapsed - lastLapStart;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 font-mono text-7xl font-black tabular-nums tracking-tight text-foreground">
        {formatMs(elapsed)}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          aria-label="Reset"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
        >
          <RotateCcw size={16} />
        </button>

        <button
          onClick={running ? pause : start}
          aria-label={running ? 'Pause' : 'Start'}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full text-black transition',
            running ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-green-500 hover:bg-green-400'
          )}
        >
          {running ? <Pause size={22} /> : <Play size={22} className="translate-x-0.5" />}
        </button>

        <button
          onClick={lap}
          aria-label="Lap"
          disabled={!running && elapsed === 0}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-30"
        >
          <Flag size={16} />
        </button>
      </div>

      {laps.length > 0 && (
        <div className="mt-8 w-full max-w-xs space-y-1">
          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Lap {laps.length + 1}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatMs(currentLapMs)}
            </span>
          </div>
          {laps.map((lapEnd, i) => {
            const lapStart = i < laps.length - 1 ? laps[i + 1] : 0;
            const lapTime  = lapEnd - lapStart;
            const lapNum   = laps.length - i;
            return (
              <div key={i} className="flex items-center justify-between rounded-lg px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">Lap {lapNum}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{formatMs(lapTime)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function Countdown() {
  const [hours,     setHours]     = useState(0);
  const [minutes,   setMinutes]   = useState(5);
  const [seconds,   setSeconds]   = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running,   setRunning]   = useState(false);
  const [finished,  setFinished]  = useState(false);

  const endTimeRef = useRef(0);
  const rafRef     = useRef(0);

  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

  const tick = useCallback(() => {
    const rem = Math.max(0, endTimeRef.current - performance.now());
    setRemaining(rem);
    if (rem <= 0) {
      setRunning(false);
      setFinished(true);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = () => {
    const ms = remaining !== null ? remaining : totalMs;
    if (ms <= 0) return;
    endTimeRef.current = performance.now() + ms;
    setRunning(true);
    setFinished(false);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setFinished(false);
    setRemaining(null);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const displayMs  = remaining !== null ? remaining : totalMs;
  const progress   = totalMs > 0 ? 1 - displayMs / totalMs : 0;
  const hasStarted = remaining !== null;

  return (
    <div className="flex flex-col items-center">
      {/* Time inputs — only when not started */}
      {!hasStarted && (
        <div className="mb-8 flex items-center gap-2">
          {([
            { label: 'h', value: hours,   set: setHours,   max: 23 },
            { label: 'm', value: minutes, set: setMinutes, max: 59 },
            { label: 's', value: seconds, set: setSeconds, max: 59 },
          ] as const).map(({ label, value, set, max }, i) => (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <span className="text-2xl font-black text-muted-foreground">:</span>}
              <div className="flex flex-col items-center gap-1">
                <input
                  type="number"
                  value={String(value).padStart(2, '0')}
                  min={0}
                  max={max}
                  onChange={(e) => set(Math.min(max, Math.max(0, Number(e.target.value))))}
                  className="w-16 rounded-xl border border-border bg-card px-2 py-2 text-center font-mono text-2xl font-bold tabular-nums text-foreground focus:border-accent focus:outline-none"
                />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Big display — after start */}
      {hasStarted && (
        <div className={cn(
          'mb-8 font-mono text-7xl font-black tabular-nums tracking-tight',
          finished ? 'text-success' : 'text-foreground'
        )}>
          {finished ? 'Done' : formatCountdown(displayMs)}
        </div>
      )}

      {/* Progress bar */}
      {hasStarted && !finished && (
        <div className="mb-8 h-1.5 w-64 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-green-500 transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          aria-label="Reset"
          disabled={!hasStarted}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-30"
        >
          <RotateCcw size={16} />
        </button>

        <button
          onClick={running ? pause : start}
          aria-label={running ? 'Pause' : 'Start'}
          disabled={totalMs === 0 && !hasStarted}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full text-black transition disabled:opacity-30',
            running ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-green-500 hover:bg-green-400'
          )}
        >
          {running
            ? <Pause size={22} />
            : <Play size={22} className="translate-x-0.5" />
          }
        </button>

        {/* spacer to balance layout */}
        <div className="h-11 w-11" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'stopwatch' | 'countdown';

export default function TimerPage() {
  const [tab, setTab] = useState<Tab>('stopwatch');

  return (
    <div className="flex flex-col items-center px-4 py-16">
      <div className="mb-12 flex rounded-xl border border-border bg-card p-1">
        {(['stopwatch', 'countdown'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-5 py-1.5 text-sm font-medium capitalize transition',
              tab === t
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'stopwatch' ? <Stopwatch /> : <Countdown />}
    </div>
  );
}
