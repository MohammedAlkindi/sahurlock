'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/next';
import { withoutFragment } from '@/lib/analytics';

/** Vercel Analytics, with every address cut at #. beforeSend is a function, so it is set in a client component. */
export function Analytics() {
  return <VercelAnalytics beforeSend={withoutFragment} />;
}
