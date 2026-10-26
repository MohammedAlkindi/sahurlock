import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('notes');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
