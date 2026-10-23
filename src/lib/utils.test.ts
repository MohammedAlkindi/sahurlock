import { describe, expect, it } from 'vitest';
import { clamp, formatFocusTime, formatTime, getFocusGrade } from '@/lib/utils';

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('formatTime', () => {
  it('formats milliseconds as mm:ss, rounding partial seconds up', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(1)).toBe('00:01');
    expect(formatTime(61_000)).toBe('01:01');
    expect(formatTime(25 * 60_000)).toBe('25:00');
  });

  it('never shows a negative time', () => {
    expect(formatTime(-5_000)).toBe('00:00');
  });
});

describe('formatFocusTime', () => {
  it('shows minutes, hours and a floor for tiny totals', () => {
    expect(formatFocusTime(30_000)).toBe('<1m');
    expect(formatFocusTime(5 * 60_000)).toBe('5m');
    expect(formatFocusTime(90 * 60_000)).toBe('1h 30m');
  });
});

describe('getFocusGrade', () => {
  it('maps score bands to letter grades', () => {
    expect(getFocusGrade(95).label).toBe('S');
    expect(getFocusGrade(90).label).toBe('S');
    expect(getFocusGrade(85).label).toBe('A');
    expect(getFocusGrade(72).label).toBe('B');
    expect(getFocusGrade(60).label).toBe('C');
    expect(getFocusGrade(59).label).toBe('D');
  });
});
