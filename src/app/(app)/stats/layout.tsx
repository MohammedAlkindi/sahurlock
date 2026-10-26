import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('stats');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
