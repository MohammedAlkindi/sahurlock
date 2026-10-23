'use client';

import { formatTime } from '@/lib/utils';
import type { AppState } from '@/lib/types';

interface Props {
  remainingMs: number;
  totalMs: number;
  appState: AppState;
  offscreenMs?: number;
  thresholdMs?: number;
}

const RADIUS      = 88;
const STROKE      = 9;
const SIZE        = (RADIUS + STROKE) * 2;
const CIRC        = 2 * Math.PI * RADIUS;

const stateColor = (s: AppState): string => {
  if (s === 'violated') return '#ef4444';
  if (s === 'warning')  return '#f59e0b';
  if (s === 'break')    return '#6366f1';
  return '#22c55e';
};

export function FocusRing({ remainingMs, totalMs, appState, offscreenMs = 0, thresholdMs = 6000 }: Props) {
  const pct  = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 1;
  const dash = pct * CIRC;
  const col  = stateColor(appState);

  // Warning arc: shows how far into the off-screen grace period we are
  const warningPct    = thresholdMs > 0 ? Math.min(1, offscreenMs / thresholdMs) : 0;
  const showWarningArc = (appState === 'warning' || appState === 'violated') && warningPct > 0;

  const label =
    appState === 'calibrating'          ? 'calibrating' :
    appState === 'countdown'            ? 'starting'    :
    appState === 'break'                ? 'on break'    :
    appState === 'violated'             ? 'lock in!'    :
    appState === 'warning'              ? 'warning'     :
    appState === 'focused'              ? 'remaining'   :
    appState === 'requesting_permission'? 'starting'    : '';

  return (
    <div className="relative inline-flex items-center justify-center select-none">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx={RADIUS + STROKE}
          cy={RADIUS + STROKE}
          r={RADIUS}
          fill="none"
          stroke="rgb(var(--border))"
          strokeWidth={STROKE}
        />

        {/* Warning ghost arc (inner, thinner) */}
        {showWarningArc && (
          <circle
            cx={RADIUS + STROKE}
            cy={RADIUS + STROKE}
            r={RADIUS}
            fill="none"
            stroke={appState === 'violated' ? '#ef444466' : '#f59e0b44'}
            strokeWidth={STROKE + 4}
            strokeDasharray={`${warningPct * CIRC} ${CIRC}`}
            strokeLinecap="round"
          />
        )}

        {/* Main progress arc */}
        <circle
          cx={RADIUS + STROKE}
          cy={RADIUS + STROKE}
          r={RADIUS}
          fill="none"
          stroke={col}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRC}`}
          className="ring-progress"
          style={{ filter: `drop-shadow(0 0 8px ${col}99)` }}
        />
      </svg>

      {/* Center text */}
      <div className="absolute flex flex-col items-center justify-center text-center">
        <span
          className="text-4xl font-black tabular-nums leading-none"
          style={{ color: col }}
        >
          {formatTime(remainingMs)}
        </span>
        {label && (
          <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
