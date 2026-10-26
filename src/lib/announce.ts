/** The one line an announcer holds. Each new line has a new id, so it is a new node and the same words twice are read twice. */
export interface Spoken {
  id: number;
  text: string;
  /** How long it stays before a newer message may replace it, in ms. */
  hold: number;
}

/**
 * How long a line stays on the page before a newer message may replace it.
 * Chrome passes live region changes to screen readers in batches about 150 ms
 * apart, so a line replaced sooner can be skipped. Half a second leaves room.
 */
export const ANNOUNCE_MIN_MS = 500;

/**
 * How long a new message waits before it replaces the line on the page, given
 * when that line arrived (0 for no line). Messages that arrive while it waits
 * join it, so each is read once, in order. Never longer than `min`, even if the
 * clock went back.
 */
export const waitBeforeShowing = (shownAt: number, now: number, min = ANNOUNCE_MIN_MS) =>
  shownAt ? Math.min(min, Math.max(0, min - (now - shownAt))) : 0;

/** About how long a screen reader takes to say one character at its default rate. */
export const SPOKEN_MS_PER_CHAR = 65;

/**
 * How long a line stays before a newer message replaces it, given its text. JAWS and
 * VoiceOver stop speaking when an assertive line changes, so it stays about as long as it
 * takes to say, never less than ANNOUNCE_MIN_MS and never more than `max`.
 */
export const readingTime = (text: string, max: number) =>
  Math.min(max, Math.max(ANNOUNCE_MIN_MS, text.length * SPOKEN_MS_PER_CHAR));

/**
 * How long an idle assertive announcer waits for more messages before it shows the first.
 * The errors from one pick of files arrive milliseconds apart, and then share one line.
 */
export const GATHER_MS = 250;
