'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behaviour for the element in `ref`: focus moves into it, Tab
 * and Shift+Tab stay inside, Escape calls `onClose`, and focus returns to
 * whatever had it before the dialog opened. Pass `active` when the component
 * stays mounted while the dialog itself is closed, and `initialFocus` to land
 * somewhere other than the first control, such as the dialog's heading. Children
 * should not use `autoFocus`: it moves focus before this hook can note where to
 * return it.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    (initialFocus?.current ?? focusables()[0] ?? dialog).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [ref, active, initialFocus]);
}
