'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { TOOLS } from '@/lib/tools';

const LABELS: Record<string, string> = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool.label]));

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => ({
    label: LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
    href: '/' + segments.slice(0, i + 1).join('/'),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight size={12} className="text-border" />
          {crumb.isLast
            ? <span className="text-foreground">{crumb.label}</span>
            : <Link href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
          }
        </span>
      ))}
    </nav>
  );
}
