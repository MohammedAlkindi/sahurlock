'use client';

import { useEffect, useCallback } from 'react';
import {
  loadScheduledSessions,
  markScheduledSessionFired,
  deleteScheduledSession,
} from '@/lib/storage';

export function useScheduler() {
  const fireNotification = useCallback((id: string, label: string) => {
    markScheduledSessionFired(id);

    if (typeof window === 'undefined') return;

    if (Notification.permission === 'granted') {
      const n = new Notification('Time to focus!', {
        body: label || 'Your scheduled study session is starting now.',
        icon: '/favicon.ico',
        tag: `sahurlock-${id}`,
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        window.location.href = '/session';
        n.close();
      };
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sessions = loadScheduledSessions().filter((s) => !s.fired);
    const handles: ReturnType<typeof setTimeout>[] = [];

    for (const s of sessions) {
      const msUntil = new Date(s.scheduledAt).getTime() - Date.now();
      if (msUntil < 0) {
        // Missed — fire immediately so user sees it on next open
        fireNotification(s.id, s.label);
      } else {
        handles.push(setTimeout(() => fireNotification(s.id, s.label), msUntil));
      }
    }

    return () => handles.forEach(clearTimeout);
  // Re-run whenever the hook mounts (page load); the page itself re-mounts
  // when navigating, so timers always stay fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    return Notification.requestPermission();
  }, []);

  return { requestPermission, deleteScheduledSession };
}
