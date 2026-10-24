'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, the newest last. Only the newest keeps focus, so one opened over another works. */
const openDialogs: HTMLElement[] = [];

/** Whether `a` comes before `b` in the document. */
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/**
 * Modal dialog behaviour for the element in `ref`: focus moves into it, Tab
 * and Shift+Tab stay inside, Escape calls `onClose`, and focus returns to
 * whatever had it before the dialog opened. Focus that leaves anyway, such as
 * to the page when the focused control goes away, is brought back or answered
 * from there. Pass `active` when the component stays mounted while the dialog
 * itself is closed, and `initialFocus` to land somewhere other than the first
 * control, such as the dialog's heading. Children should not use `autoFocus`:
 * it moves focus before this hook can note where to return it.
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
    const enter = () => (initialFocus?.current ?? focusables()[0] ?? dialog).focus();
    const isTop = () => openDialogs[openDialogs.length - 1] === dialog;
    openDialogs.push(dialog);
    enter();

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
      const current = document.activeElement;
      // From outside the controls, such as the heading, the browser's next or
      // previous control can lie outside the dialog, so wrap there too.
      const inside = current !== null && dialog.contains(current);
      if (e.shiftKey && (!inside || current === first || precedes(current, first))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || current === last || precedes(last, current))) { e.preventDefault(); first.focus(); }
    };
    // Keys pressed with focus outside the dialog, on the page after a focused control was removed.
    const onStrayKeyDown = (e: KeyboardEvent) => {
      if (isTop() && !dialog.contains(document.activeElement)) onKeyDown(e);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isTop() && e.target instanceof Node && !dialog.contains(e.target)) enter();
    };

    dialog.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onStrayKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onStrayKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      previous?.focus();
    };
  }, [ref, active, initialFocus]);
}
