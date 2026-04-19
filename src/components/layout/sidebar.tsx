'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Timer,
  CheckSquare,
  BarChart2,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Layers,
  Settings2,
  Clock,
  Music2,
  CalendarClock,
} from 'lucide-react';

function SahurLockMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="currentColor" className="text-accent"/>
      <path d="M10 32 C18 20, 46 20, 54 32 C46 44, 18 44, 10 32Z" fill="none" stroke="white" strokeWidth="3"/>
      <circle cx="32" cy="32" r="8.5" stroke="white" strokeWidth="2.5"/>
      <circle cx="32" cy="32" r="4" fill="white"/>
      <path d="M29.5 30.5V28a2.5 2.5 0 015 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-accent"/>
      <rect x="27.5" y="30" width="9" height="7" rx="2" fill="currentColor" className="text-accent"/>
      <circle cx="32" cy="33.2" r="1.3" fill="white"/>
      <rect x="31.3" y="33.8" width="1.4" height="2" rx="0.7" fill="white"/>
    </svg>
  );
}
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/session',    icon: Timer,         label: 'Session'    },
  { href: '/tasks',      icon: CheckSquare,   label: 'Tasks'      },
  { href: '/stats',      icon: BarChart2,     label: 'Stats'      },
  { href: '/schedule',   icon: CalendarClock, label: 'Schedule'   },
  { href: '/notes',      icon: NotebookPen,   label: 'Notes'      },
  { href: '/flashcards', icon: Layers,        label: 'Flashcards' },
  { href: '/timer',      icon: Clock,         label: 'Timer'      },
  { href: '/sounds',     icon: Music2,        label: 'Sounds'     },
];

const COLLAPSED_KEY = 'sahurlock.sidebar.collapsed';

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted,   setMounted]   = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {}
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const settingsActive = pathname.startsWith('/settings');

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-14' : 'w-52'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center border-b border-border py-4',
        collapsed ? 'justify-center px-0' : 'gap-2 px-4'
      )}>
        <Link href="/" className="flex items-center gap-1.5 font-black tracking-tight hover:opacity-80 transition-opacity">
          <SahurLockMark size={22} />
          {!collapsed && <span>SahurLock</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-2 pt-3">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-border p-2 space-y-0.5">
        {/* Settings */}
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
            collapsed && 'justify-center',
            settingsActive
              ? 'bg-accent/10 text-accent'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Settings2 size={17} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center'
            )}
          >
            {theme === 'dark'
              ? <Sun size={17} className="shrink-0 text-yellow-400" />
              : <Moon size={17} className="shrink-0 text-blue-400" />
            }
            {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
          </button>
        )}

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            collapsed && 'justify-center'
          )}
        >
          {collapsed
            ? <PanelLeftOpen size={17} className="shrink-0" />
            : <><PanelLeftClose size={17} className="shrink-0" /><span>Collapse</span></>
          }
        </button>
      </div>
    </aside>
  );
}
