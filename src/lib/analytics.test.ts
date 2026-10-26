import { describe, expect, it } from 'vitest';
import { withoutFragment } from '@/lib/analytics';

describe('withoutFragment', () => {
  it('sends the Spotify callback without the token in its fragment', () => {
    const event = { type: 'pageview' as const, url: 'https://sahurlock.vercel.app/spotify/callback#spotify_access_token=secret&expires_in=3600' };
    expect(withoutFragment(event)).toEqual({ type: 'pageview', url: 'https://sahurlock.vercel.app/spotify/callback' });
  });

  it('keeps the path and query of any other address', () => {
    const event = { type: 'event' as const, url: 'https://sahurlock.vercel.app/spotify/callback?error=access_denied' };
    expect(withoutFragment(event)).toEqual(event);
  });
});
