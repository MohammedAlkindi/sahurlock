'use client';

import type { ScoreBreakdown } from '@/lib/focus-score';

interface Props {
  breakdown: ScoreBreakdown;
  /** Show header label and total. Default true. */
  showHeader?: boolean;
}

const COMPONENTS: Array<{
  key: keyof Omit<ScoreBreakdown, 'total'>;
  label: string;
  max: number;
  bar: string;
}> = [
  { key: 'focusRatio',    label: 'Focus ratio',  max: 50, bar: 'bg-green-500'  },
  { key: 'control',       label: 'Control',      max: 25, bar: 'bg-blue-500'   },
  { key: 'recoverySpeed', label: 'Recovery',     max: 15, bar: 'bg-purple-500' },
  { key: 'stability',     label: 'Stability',    max: 10, bar: 'bg-cyan-500'   },
];

export function ScoreBreakdownPanel({ breakdown, showHeader = true }: Props) {
  return (
    <div className="space-y-0">
      {showHeader && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Score breakdown
          </span>
          <span className="text-xs text-muted-foreground">out of 100</span>
        </div>
      )}

      <div className="space-y-2.5">
        {COMPONENTS.map(({ key, label, max, bar }) => {
          const value = breakdown[key] as number;
          const pct   = Math.round((value / max) * 100);
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums text-foreground">
                  {value}
                  <span className="text-muted-foreground">/{max}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-2.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="font-bold tabular-nums text-foreground">{breakdown.total} / 100</span>
      </div>
    </div>
  );
}
