import { describe, expect, it } from 'vitest';
import { ANNOUNCE_MIN_MS, waitBeforeShowing } from './announce';

describe('waitBeforeShowing', () => {
  it('shows a message at once when no line is on the page', () => {
    expect(waitBeforeShowing(0, 10_000)).toBe(0);
  });

  it('holds a message until the line on the page has been there long enough', () => {
    expect(waitBeforeShowing(10_000, 10_100)).toBe(ANNOUNCE_MIN_MS - 100);
    expect(waitBeforeShowing(10_000, 10_000)).toBe(ANNOUNCE_MIN_MS);
  });

  it('never holds a message longer than the minimum, even if the clock went back', () => {
    expect(waitBeforeShowing(10_000, 9_000)).toBe(ANNOUNCE_MIN_MS);
  });

  it('shows a message at once when the line has been there long enough', () => {
    expect(waitBeforeShowing(10_000, 10_000 + ANNOUNCE_MIN_MS)).toBe(0);
    expect(waitBeforeShowing(10_000, 20_000)).toBe(0);
  });
});
