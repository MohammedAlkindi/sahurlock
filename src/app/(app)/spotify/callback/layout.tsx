import type { Metadata } from 'next';
import { SITE_OPEN_GRAPH } from '@/lib/site';

// A step in connecting Spotify, not a page anyone should find in search.
export const metadata: Metadata = {
  title: 'Connecting Spotify',
  robots: { index: false, follow: false },
  openGraph: SITE_OPEN_GRAPH,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
