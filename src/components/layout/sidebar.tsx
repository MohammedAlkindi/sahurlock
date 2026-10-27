'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, PanelLeftClose, PanelLeftOpen, Sun, Moon, Settings2 } from 'lucide-react';
import { TOOLS, toolHref } from '@/lib/tools';

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

const COLLAPSED_KEY = 'sahurlock.sidebar.collapsed';

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted,   setMounted]   = useState(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);

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

  const contents = (collapsed: boolean) => (
    <>
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
      <nav aria-label="Tools" className="flex-1 space-y-0.5 p-2 pt-3">
        {TOOLS.map((tool) => {
          const { icon: Icon, label } = tool;
          const href = toolHref(tool);
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => mobileMenu.current?.close()}
              aria-label={label}
              title={collapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
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
          onClick={() => mobileMenu.current?.close()}
          aria-label="Settings"
          title={collapsed ? 'Settings' : undefined}
          aria-current={settingsActive ? 'page' : undefined}
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
            aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground',
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
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'hidden w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex',
            collapsed && 'justify-center'
          )}
        >
          {collapsed
            ? <PanelLeftOpen size={17} className="shrink-0" />
            : <><PanelLeftClose size={17} className="shrink-0" /><span>Collapse</span></>
          }
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link href="/" className="font-black">SahurLock</Link>
        <button type="button" aria-label="Open navigation" aria-haspopup="dialog"
          onClick={() => mobileMenu.current?.showModal()}
          className="rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <Menu size={22} aria-hidden="true" />
        </button>
      </div>
      <aside className={cn('hidden h-full shrink-0 flex-col border-r border-border bg-card md:flex', collapsed ? 'w-14' : 'w-52')}>
        {contents(collapsed)}
      </aside>
      <dialog ref={mobileMenu} aria-label="Navigation"
        className="m-0 h-dvh max-h-none w-72 max-w-[90vw] border-r border-border bg-card p-0 text-foreground backdrop:bg-black/40"
        onClick={(event) => { if (event.target === event.currentTarget) mobileMenu.current?.close(); }}>
        <div className="flex h-full flex-col">
          <button type="button" aria-label="Close navigation" onClick={() => mobileMenu.current?.close()}
            className="absolute right-2 top-2 rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <X size={20} aria-hidden="true" />
          </button>
          {contents(false)}
        </div>
      </dialog>
    </>
  );
}
