import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/tools';

describe('TOOLS', () => {
  it('points every tool at a page that exists', () => {
    const missing = TOOLS.filter((tool) => !existsSync(`src/app/(app)/${tool.id}/page.tsx`));
    expect(missing.map((t) => t.id)).toEqual([]);
  });

  it('has no duplicate ids or labels', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.label)).size).toBe(TOOLS.length);
  });
});
