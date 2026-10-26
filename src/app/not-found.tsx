import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/site-footer';
import { TOOLS, toolHref } from '@/lib/tools';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">This page does not exist</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          The link may be old or mistyped. Try one of SahurLock&apos;s tools:
        </p>
        <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TOOLS.map((tool) => (
            <li key={tool.id}>
              <Link
                href={toolHref(tool)}
                className="block rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:border-foreground/20"
              >
                {tool.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className="mt-8 text-sm font-medium text-accent hover:underline">
          Go to the home page
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
