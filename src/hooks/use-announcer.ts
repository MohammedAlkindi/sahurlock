'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ANNOUNCE_MIN_MS, GATHER_MS, type Spoken, readingTime, waitBeforeShowing } from '@/lib/announce';

/**
 * How long a line stays in an announcer after it reaches the page, at least,
 * and a second longer than its hold. Screen readers take the words when the
 * line arrives. Dropping it later keeps a reader moving through the page from
 * hearing the message a second time, or after the visible message has gone.
 * Removing a line is not announced.
 */
export const ANNOUNCE_HOLD_MS = 7000;

/** Ids for the lines of both announcers, so no two lines share one. */
let lastId = 0;

interface LineTiming {
  /** How long a line stays before a newer message may replace it. */
  holdFor: (text: string) => number;
  /** How long an idle announcer waits for more messages before it shows the first. */
  gatherMs: number;
}

// A polite line waits behind current speech, so it only has to outlast Chrome's batching.
const POLITE: LineTiming = { holdFor: () => ANNOUNCE_MIN_MS, gatherMs: 0 };
// An assertive line cuts off current speech on JAWS and VoiceOver. So it stays until it has been
// said, however long, and messages that arrive together share it instead of cutting each other off.
const ASSERTIVE: LineTiming = { holdFor: (text) => readingTime(text, Infinity), gatherMs: GATHER_MS };

/** A message waiting for the line, and, for one about something that can go away, whether it still holds. */
interface Waiting {
  text: string;
  current?: () => boolean;
}

/**
 * One announcer's line, and a function that says a message on it. A message
 * becomes a new line, as a new node, so only it is read. It waits until the
 * line on the page has been there long enough to be read (waitBeforeShowing
 * with the line's hold), and messages said meanwhile, or in the same update,
 * share the next line. A message whose `current` says it no longer holds when
 * its turn comes is dropped, so nothing out of date is read, and `retract`
 * also takes off the line on the page once none of its messages hold.
 */
function useAnnouncerLine({ holdFor, gatherMs }: LineTiming) {
  const [line, setLine] = useState<Spoken | null>(null);
  const waiting = useRef<Waiting[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the line on the page arrived, on the monotonic clock. 0 for none. Set when a line is
  // shown, so a message in the next task waits even before React has rendered it, then set
  // again to the moment React put it on the page.
  const shownAt = useRef(0);
  useLayoutEffect(() => { shownAt.current = line ? performance.now() : 0; }, [line]);
  // How long the line on the page stays before a newer one may replace it.
  const holdMs = useRef(ANNOUNCE_MIN_MS);
  // The checks of the messages on that line, undefined for one that always holds.
  const lineChecks = useRef<Waiting['current'][]>([]);

  const show = useCallback(() => {
    timer.current = null;
    if (waiting.current.length === 0) return;
    const wait = waitBeforeShowing(shownAt.current, performance.now(), holdMs.current);
    if (wait > 0) {
      timer.current = setTimeout(show, wait);
      return;
    }
    const live = waiting.current.filter((message) => !message.current || message.current());
    waiting.current = [];
    if (live.length === 0) return;
    const text = live.map((message) => message.text).join(' ');
    const hold = holdFor(text);
    lastId += 1;
    setLine({ id: lastId, text, hold });
    lineChecks.current = live.map((message) => message.current);
    holdMs.current = hold;
    shownAt.current = performance.now();
  }, [holdFor]);

  // Drop the waiting messages that no longer hold, and the line on the page once none of its do, so
  // the next message goes out after the usual gathering wait instead of waiting out the old line.
  const retract = useCallback(() => {
    waiting.current = waiting.current.filter((message) => !message.current || message.current());
    const checks = lineChecks.current;
    if (checks.length === 0 || !checks.every((check) => check && !check())) return;
    lineChecks.current = [];
    shownAt.current = 0;
    setLine(null);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(show, gatherMs);
    }
  }, [show, gatherMs]);

  const say = useCallback((text: string, current?: () => boolean) => {
    waiting.current.push({ text, current });
    if (timer.current) return;
    // With no line on the page, wait a moment for the messages that arrive with this one.
    const wait = shownAt.current ? waitBeforeShowing(shownAt.current, performance.now(), holdMs.current) : gatherMs;
    timer.current = setTimeout(show, wait);
  }, [show, gatherMs]);

  // Drop the line once it has been read, unless a newer one replaced it.
  useEffect(() => {
    if (!line) return;
    const drop = setTimeout(() => setLine((now) => (now?.id === line.id ? null : now)), Math.max(ANNOUNCE_HOLD_MS, line.hold + 1000));
    return () => clearTimeout(drop);
  }, [line]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return [line, say, retract] as const;
}

/**
 * The lines for two screen reader announcers, one polite and one assertive,
 * which stay on the page and hold one line each.
 */
export function useAnnouncer() {
  const [polite, sayPolitely, retractPolite] = useAnnouncerLine(POLITE);
  const [assertive, sayAssertively, retractAssertive] = useAnnouncerLine(ASSERTIVE);
  /** Says `text`. With `current`, it is dropped if that no longer holds when its turn comes. */
  const announce = useCallback((text: string, urgency: 'polite' | 'assertive' = 'polite', current?: () => boolean) => {
    if (urgency === 'assertive') sayAssertively(text, current);
    else sayPolitely(text, current);
  }, [sayPolitely, sayAssertively]);
  /** Takes back what no longer holds: waiting messages, and a line none of whose messages hold. */
  const retract = useCallback(() => {
    retractPolite();
    retractAssertive();
  }, [retractPolite, retractAssertive]);
  return { polite, assertive, announce, retract };
}
