'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Spoken, waitBeforeShowing } from '@/lib/announce';

/**
 * How long a line stays in an announcer after it reaches the page. Screen
 * readers take the words when the line arrives. Dropping it later keeps a
 * reader moving through the page from hearing the message a second time, or
 * after the visible message has gone. Removing a line is not announced.
 */
export const ANNOUNCE_HOLD_MS = 7000;

/** Ids for the lines of both announcers, so no two lines share one. */
let lastId = 0;

/**
 * One announcer's line, and a function that says a message on it. A message
 * becomes a new line, as a new node, so only it is read. It waits until the
 * line on the page has been there long enough to be read (waitBeforeShowing),
 * and messages said meanwhile, or in the same update, share the next line.
 */
function useAnnouncerLine() {
  const [line, setLine] = useState<Spoken | null>(null);
  const waiting = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the line on the page arrived, on the monotonic clock. 0 for none. Set when a line is
  // shown, so a message in the next task waits even before React has rendered it, then set
  // again to the moment React put it on the page.
  const shownAt = useRef(0);
  useLayoutEffect(() => { shownAt.current = line ? performance.now() : 0; }, [line]);

  const show = useCallback(() => {
    timer.current = null;
    if (waiting.current.length === 0) return;
    const wait = waitBeforeShowing(shownAt.current, performance.now());
    if (wait > 0) {
      timer.current = setTimeout(show, wait);
      return;
    }
    lastId += 1;
    setLine({ id: lastId, text: waiting.current.join(' ') });
    waiting.current = [];
    shownAt.current = performance.now();
  }, []);

  const say = useCallback((text: string) => {
    waiting.current.push(text);
    if (timer.current) return;
    timer.current = setTimeout(show, waitBeforeShowing(shownAt.current, performance.now()));
  }, [show]);

  // Drop the line once it has been read, unless a newer one replaced it.
  useEffect(() => {
    if (!line) return;
    const drop = setTimeout(() => setLine((now) => (now?.id === line.id ? null : now)), ANNOUNCE_HOLD_MS);
    return () => clearTimeout(drop);
  }, [line]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return [line, say] as const;
}

/**
 * The lines for two screen reader announcers, one polite and one assertive,
 * which stay on the page and hold one line each.
 */
export function useAnnouncer() {
  const [polite, sayPolitely] = useAnnouncerLine();
  const [assertive, sayAssertively] = useAnnouncerLine();
  const announce = useCallback((text: string, urgency: 'polite' | 'assertive' = 'polite') => {
    if (urgency === 'assertive') sayAssertively(text);
    else sayPolitely(text);
  }, [sayPolitely, sayAssertively]);
  return { polite, assertive, announce };
}
