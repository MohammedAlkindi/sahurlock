'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Timer, CheckSquare, BarChart2, NotebookPen, Home, Music2, FlipHorizontal2, Settings, Clock } from 'lucide-react';

const ITEMS = [
  { label: 'New Session',  href: '/session',    icon: Timer,           keywords: 'start focus work pomodoro' },
  { label: 'Tasks',        href: '/tasks',      icon: CheckSquare,     keywords: 'checklist todo add task' },
  { label: 'Stats',        href: '/stats',      icon: BarChart2,       keywords: 'history performance score' },
  { label: 'Notes',        href: '/notes',      icon: NotebookPen,     keywords: 'scratchpad write journal' },
  { label: 'Flashcards',   href: '/flashcards', icon: FlipHorizontal2, keywords: 'cards review study spaced' },
  { label: 'Sounds',       href: '/sounds',     icon: Music2,          keywords: 'ambient noise rain music' },
  { label: 'Timer',        href: '/timer',      icon: Clock,           keywords: 'countdown stopwatch' },
  { label: 'Settings',     href: '/settings',   icon: Settings,        keywords: 'config preferences advanced' },
  { label: 'Home',         href: '/',           icon: Home,            keywords: 'landing' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <div className="flex items-center border-b border-border px-4">
            <Command.Input
              placeholder="Go to…"
              className="flex-1 bg-transparent py-3.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none"
              autoFocus
            />
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results.
            </Command.Empty>
            {ITEMS.map(({ label, href, icon: Icon, keywords }) => (
              <Command.Item
                key={href}
                keywords={[keywords]}
                onSelect={() => { router.push(href); setOpen(false); }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground data-[selected=true]:bg-muted transition-colors"
              >
                <Icon size={16} className="shrink-0 text-muted-foreground" />
                {label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
