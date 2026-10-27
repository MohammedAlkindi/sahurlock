'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { CommandPalette } from '@/components/layout/command-palette';
import { useEffect } from 'react';
import { useScheduler } from '@/hooks/use-scheduler';
import { finishPendingLogout } from '@/lib/spotify-logout';

function SchedulerMount() {
  useScheduler();
  return null;
}

/**
 * Finishes a Spotify disconnect that did not reach the server: on whichever
 * page loads next, and when the browser comes back online.
 */
function SpotifyLogoutRetry() {
  useEffect(() => {
    finishPendingLogout();
    window.addEventListener('online', finishPendingLogout);
    return () => window.removeEventListener('online', finishPendingLogout);
  }, []);
  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card/50 px-4 backdrop-blur-sm">
          <Breadcrumb />
          <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ⌘K
          </kbd>
        </header>
        {/* Canvas */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <CommandPalette />
      <SchedulerMount />
      <SpotifyLogoutRetry />
    </div>
  );
}
