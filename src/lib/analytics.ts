import type { BeforeSendEvent } from '@vercel/analytics';

/**
 * Drops the part of the address after #, before Vercel Analytics sends it. The Spotify sign-in
 * puts its access token there, and the analytics script reports the full address it finds.
 */
export const withoutFragment = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: event.url.split('#')[0] });
