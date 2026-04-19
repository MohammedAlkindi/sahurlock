'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Bell, BellOff, Trash2, Play, Clock } from 'lucide-react';
import {
  loadScheduledSessions,
  saveScheduledSession,
  deleteScheduledSession,
} from '@/lib/storage';
import { ScheduledSession } from '@/lib/types';
import { useScheduler } from '@/hooks/use-scheduler';

const DURATIONS = [25, 45, 60, 90, 120];

function minToLabel(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const totalMin = Math.floor(diff / 60_000);
  if (totalMin < 60) return `in ${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

export default function SchedulePage() {
  const router = useRouter();
  const { requestPermission } = useScheduler();

  const [sessions, setSessions]           = useState<ScheduledSession[]>([]);
  const [permission, setPermission]       = useState<NotificationPermission>('default');
  const [label, setLabel]                 = useState('');
  const [datetime, setDatetime]           = useState('');
  const [duration, setDuration]           = useState(25);
  const [customDuration, setCustomDuration] = useState('');
  const [useCustom, setUseCustom]         = useState(false);
  const [error, setError]                 = useState('');

  const reload = useCallback(() => {
    setSessions(loadScheduledSessions().sort((a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    ));
  }, []);

  useEffect(() => {
    reload();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, [reload]);

  // Default datetime to 1 hour from now
  useEffect(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setSeconds(0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    setDatetime(local);
  }, []);

  const handleEnableNotifications = async () => {
    const p = await requestPermission();
    setPermission(p);
  };

  const handleAdd = () => {
    setError('');
    if (!datetime) { setError('Please pick a date and time.'); return; }
    const at = new Date(datetime);
    if (at.getTime() <= Date.now()) { setError('Scheduled time must be in the future.'); return; }

    const mins = useCustom ? parseInt(customDuration, 10) : duration;
    if (!mins || mins < 5 || mins > 480) { setError('Duration must be between 5 and 480 minutes.'); return; }

    const session: ScheduledSession = {
      id: `sched_${Date.now()}`,
      label: label.trim() || 'Focus session',
      scheduledAt: at.toISOString(),
      durationMinutes: mins,
      fired: false,
    };

    saveScheduledSession(session);
    reload();
    setLabel('');
    setError('');
  };

  const handleDelete = (id: string) => {
    deleteScheduledSession(id);
    reload();
  };

  const handleStartNow = (s: ScheduledSession) => {
    router.push(`/session?duration=${s.durationMinutes}`);
  };

  const upcoming = sessions.filter((s) => !s.fired && new Date(s.scheduledAt) > new Date());
  const past     = sessions.filter((s) => s.fired || new Date(s.scheduledAt) <= new Date());

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <CalendarClock size={22} className="text-accent" />
        <h1 className="text-2xl font-black tracking-tight">Schedule</h1>
      </div>

      {/* Notification permission banner */}
      {permission !== 'granted' && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-yellow-200 bg-yellow-50/60 px-5 py-4 dark:border-yellow-900/40 dark:bg-yellow-950/20">
          <div className="flex items-center gap-3">
            <BellOff size={16} className="shrink-0 text-yellow-600 dark:text-yellow-400" />
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              {permission === 'denied'
                ? 'Notifications are blocked. Enable them in browser settings to get alerts.'
                : 'Enable notifications to get alerted when your session starts.'}
            </p>
          </div>
          {permission !== 'denied' && (
            <button
              onClick={handleEnableNotifications}
              className="shrink-0 flex items-center gap-1.5 rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-yellow-400 transition"
            >
              <Bell size={12} /> Enable
            </button>
          )}
        </div>
      )}

      {/* Add session form */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">New scheduled session</h2>

        <div className="space-y-3">
          {/* Label */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Evening study"
              maxLength={60}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition"
            />
          </div>

          {/* Date/time */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Date & time
            </label>
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => { setDuration(d); setUseCustom(false); }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    !useCustom && duration === d
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-muted-foreground hover:border-accent/40 hover:text-foreground'
                  }`}
                >
                  {minToLabel(d)}
                </button>
              ))}
              <button
                onClick={() => setUseCustom(true)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  useCustom
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:border-accent/40 hover:text-foreground'
                }`}
              >
                Custom
              </button>
            </div>
            {useCustom && (
              <input
                type="number"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                placeholder="minutes (5–480)"
                min={5}
                max={480}
                className="mt-2 w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition"
              />
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleAdd}
            className="mt-1 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-accent-foreground hover:opacity-90 transition"
          >
            Schedule session
          </button>
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Upcoming
            <span className="ml-2 text-xs font-normal text-muted-foreground">{upcoming.length}</span>
          </h2>
          <div className="space-y-2">
            {upcoming.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.label}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock size={10} className="shrink-0" />
                    {new Date(s.scheduledAt).toLocaleString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    <span className="text-accent font-medium">· {relativeTime(s.scheduledAt)}</span>
                    <span>· {minToLabel(s.durationMinutes)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => handleStartNow(s)}
                    title="Start now"
                    className="rounded-lg p-2 text-muted-foreground/50 transition hover:bg-accent/10 hover:text-accent"
                  >
                    <Play size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    title="Delete"
                    className="rounded-lg p-2 text-muted-foreground/30 transition hover:bg-muted hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past / fired */}
      {past.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Past</h2>
          <div className="space-y-2">
            {past.slice(0, 10).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3 opacity-60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(s.scheduledAt).toLocaleString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    {' · '}{minToLabel(s.durationMinutes)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground/30 transition hover:bg-muted hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/50 bg-card/30 py-16 text-center">
          <CalendarClock size={28} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No sessions scheduled yet</p>
        </div>
      )}
    </div>
  );
}
