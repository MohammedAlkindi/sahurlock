import Link from 'next/link';
import { SiteFooter } from '@/components/site-footer';

interface DocumentPageProps {
  title: string;
  updated: string;
  children: React.ReactNode;
}

/** A plain page of text, such as the privacy policy, with the site's name and footer around it. */
export function DocumentPage({ title, updated, children }: DocumentPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card/90">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="text-base font-black tracking-tight">
            <span className="text-accent">S</span>ahurLock
          </Link>
          <Link href="/session" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Open the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-8 space-y-4 text-sm leading-7 text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
