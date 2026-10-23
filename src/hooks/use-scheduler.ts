'use client';

import { useEffect } from 'react';
import {
  SCHEDULE_CHANGED_EVENT,
  SCHEDULE_KEY,
  loadScheduledSessions,
  markScheduledSessionFired,
} from '@/lib/storage';
import { planReminders } from '@/lib/schedule-plan';

const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

function notify(id: string, label: string) {
  markScheduledSessionFired(id);
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const n = new Notification('Time to focus!', {
    body: label || 'Your scheduled study session is starting now.',
    icon: '/icon.svg',
    tag: `sahurlock-${id}`,
    requireInteraction: true,
  });
  n.onclick = () => {
    window.focus();
    window.location.href = '/session';
    n.close();
  };
}

/** Ask once for notification permission. Browsers without the API report denied. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

/**
 * Arms a timer for every upcoming scheduled session. Mount it once, in the app
 * layout. It re-arms when schedules change in this tab or another one.
 */
export function useScheduler() {
  useEffect(() => {
    let handles: ReturnType<typeof setTimeout>[] = [];

    const arm = () => {
      handles.forEach(clearTimeout);
      handles = [];
      const plan = planReminders(loadScheduledSessions(), Date.now());
      plan.expire.forEach((s) => markScheduledSessionFired(s.id));
      plan.fireNow.forEach((s) => notify(s.id, s.label));
      for (const { session, delayMs, final } of plan.later) {
        handles.push(setTimeout(() => (final ? notify(session.id, session.label) : arm()), delayMs));
      }
    };

    arm();
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === SCHEDULE_KEY) arm(); };
    window.addEventListener(SCHEDULE_CHANGED_EVENT, arm);
    window.addEventListener('storage', onStorage);
    return () => {
      handles.forEach(clearTimeout);
      window.removeEventListener(SCHEDULE_CHANGED_EVENT, arm);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
}
