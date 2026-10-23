'use client';

import type { Paper } from '@/lib/scan/pdf';

interface Props {
  value: Paper;
  onChange: (paper: Paper) => void;
}

/** The paper size PDFs are laid out on. */
export function PaperSelect({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Paper
      <select value={value} onChange={(e) => onChange(e.target.value as Paper)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none">
        <option value="a4">A4</option>
        <option value="letter">Letter</option>
      </select>
    </label>
  );
}
