'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { say, type Spoken } from '@/lib/announce';

/**
 * How long a line stays in an announcer after it reaches the page. Screen
 * readers take the words when the line arrives. Dropping it later keeps a
 * reader moving through the page from hearing the message a second time, or
 * after the visible message has gone. Removing a line is not announced.
 */
export const ANNOUNCE_HOLD_MS = 7000;

/** Drop `line` once it has been on the page for ANNOUNCE_HOLD_MS, unless a newer line replaced it. */
function useDropLater(line: Spoken | null, set: (update: (line: Spoken | null) => Spoken | null) => void) {
  useEffect(() => {
    if (!line) return;
    const timer = setTimeout(() => set((now) => (now?.id === line.id ? null : now)), ANNOUNCE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [line, set]);
}

/**
 * The lines for two screen reader announcers, one polite and one assertive,
 * which stay on the page and hold one line each. A message replaces the line
 * as a new node, so only that message is read, never one said before it.
 * Messages said in one update share a line, so each of them is read.
 */
export function useAnnouncer() {
  const [polite, setPolite] = useState<Spoken | null>(null);
  const [assertive, setAssertive] = useState<Spoken | null>(null);
  const nextId = useRef(0);
  // The ids on the page, noted as soon as React has put a line there.
  const shown = useRef({ polite: 0, assertive: 0 });
  useLayoutEffect(() => { shown.current.polite = polite?.id ?? 0; }, [polite]);
  useLayoutEffect(() => { shown.current.assertive = assertive?.id ?? 0; }, [assertive]);
  useDropLater(polite, setPolite);
  useDropLater(assertive, setAssertive);

  const announce = useCallback((text: string, urgency: 'polite' | 'assertive' = 'polite') => {
    nextId.current += 1;
    const id = nextId.current;
    if (urgency === 'assertive') setAssertive((line) => say(line, text, shown.current.assertive, id));
    else setPolite((line) => say(line, text, shown.current.polite, id));
  }, []);

  return { polite, assertive, announce };
}
