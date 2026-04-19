'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { CommandPalette } from '@/components/layout/command-palette';
import { useScheduler } from '@/hooks/use-scheduler';

function SchedulerMount() {
  useScheduler();
  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
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
    </div>
  );
}
