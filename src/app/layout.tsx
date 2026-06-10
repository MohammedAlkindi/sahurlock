import './globals.css';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ThemeProvider } from 'next-themes';
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: 'SahurLock',
  description:
    'Real-time eye gaze tracking via MediaPipe. Configurable grace period, punishment clips on violation. 100% local, no cloud.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="sahurlock-theme">
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
