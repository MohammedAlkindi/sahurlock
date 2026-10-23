export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const formatTime = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export const formatFocusTime = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes === 0) return '<1m';
  return `${minutes}m`;
};

export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface FocusGrade {
  label: string;
  color: string;
  bg: string;
  ring: string;
}

export const getFocusGrade = (score: number): FocusGrade => {
  if (score >= 90) return { label: 'S', color: 'text-amber-600', bg: 'bg-amber-500/15', ring: 'ring-amber-400/40' };
  if (score >= 80) return { label: 'A', color: 'text-green-600', bg: 'bg-green-500/15', ring: 'ring-green-500/40' };
  if (score >= 70) return { label: 'B', color: 'text-blue-600', bg: 'bg-blue-500/15', ring: 'ring-blue-500/40' };
  if (score >= 60) return { label: 'C', color: 'text-orange-600', bg: 'bg-orange-500/15', ring: 'ring-orange-500/40' };
  return { label: 'D', color: 'text-red-600', bg: 'bg-red-500/15', ring: 'ring-red-500/40' };
};
