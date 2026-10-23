import { AppState, AttentionReading } from '@/lib/types';

interface TransitionInput {
  attention: AttentionReading | null;
  offscreenMs: number;
  thresholdMs: number;
  onBreak: boolean;
  violationActive: boolean;
}

/**
 * Whether a frame may add to focused time. Only a confident, on-screen,
 * focused reading counts. An uncertain reading with a face present is neither
 * focused nor a distraction.
 */
export const frameCountsAsFocused = (reading: AttentionReading | null): boolean =>
  !!reading && reading.facePresent && reading.attention === 'focused';

export const getDerivedState = ({
  attention,
  offscreenMs,
  thresholdMs,
  onBreak,
  violationActive
}: TransitionInput): AppState => {
  if (onBreak) return 'break';
  if (violationActive) return 'violated';
  if (!attention || attention.attention === 'uncertain') return 'warning';
  if (attention.attention === 'warning') return 'warning';
  if (attention.attention === 'offscreen' && offscreenMs >= thresholdMs * 0.5) return 'warning';
  return 'focused';
};
