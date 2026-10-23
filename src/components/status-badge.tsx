'use client';

import { AppState } from '@/lib/types';
import { cn } from '@/lib/cn';

const labelMap: Record<AppState, string> = {
  idle: 'Idle',
  requesting_permission: 'Requesting Camera',
  calibrating: 'Calibrating',
  countdown: 'Get Ready',
  focused: 'Focused',
  warning: 'Warning',
  break: 'On Break',
  violated: 'VIOLATED',
  session_complete: 'Complete',
  camera_error: 'Camera Error'
};

export function StatusBadge({ state }: { state: AppState }) {
  if (state === 'idle') return null;
  return (
    <span
      className={cn(
        'rounded-full px-3.5 py-1.5 text-xs font-bold tracking-wide',
        ['requesting_permission', 'countdown'].includes(state) && 'bg-muted text-muted-foreground',
        state === 'calibrating'     && 'bg-blue-500/15 text-blue-700',
        state === 'focused'         && 'bg-success/15 text-success',
        state === 'warning'         && 'bg-warning/15 text-warning',
        state === 'break'           && 'bg-warning/15 text-warning',
        state === 'violated'        && 'bg-danger/15 text-danger',
        state === 'camera_error'    && 'bg-danger/15 text-danger',
        state === 'session_complete' && 'bg-purple-500/15 text-purple-700',
      )}
    >
      {labelMap[state]}
    </span>
  );
}
