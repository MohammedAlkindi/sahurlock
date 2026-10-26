import { describe, expect, it } from 'vitest';
import { ANNOUNCE_MIN_MS, SPOKEN_MS_PER_CHAR, readingTime, waitBeforeShowing } from './announce';

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

describe('readingTime', () => {
  it('keeps a long line about as long as it takes to say', () => {
    const error = 'one.pdf could not be read as a PDF. If it has a password, export it again without one.';
    expect(readingTime(error, 6000)).toBe(error.length * SPOKEN_MS_PER_CHAR);
  });

  it('keeps a short line at least as long as any line', () => {
    expect(readingTime('Saved.', 6000)).toBe(ANNOUNCE_MIN_MS);
  });

  it('keeps a line no longer than the cap it is given', () => {
    expect(readingTime('x'.repeat(1000), 6000)).toBe(6000);
  });

  it('holds a long line in full when there is no cap, as the assertive announcer does', () => {
    expect(readingTime('x'.repeat(200), Infinity)).toBe(200 * SPOKEN_MS_PER_CHAR);
  });
});
