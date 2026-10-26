import Link from 'next/link';

const REPO_URL = 'https://github.com/MohammedAlkindi/sahurlock';

const LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

/** The footer on the landing page and the pages that read like documents. */
export function SiteFooter() {
  // Rendered at build time, and every deploy rebuilds it.
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border px-6 py-4 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span>&copy; {year} Mohammed Alkindi. MIT License.</span>
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-foreground hover:underline">
            {link.label}
          </Link>
        ))}
        <a href={REPO_URL} className="hover:text-foreground hover:underline">
          Source code on GitHub
        </a>
      </div>
    </footer>
  );
}
