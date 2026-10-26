import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('tasks');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
