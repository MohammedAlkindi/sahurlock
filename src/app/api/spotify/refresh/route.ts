import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookie, sameOrigin, storedRefreshToken } from '@/lib/spotify-server';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/**
 * A new access token, from the refresh token in the httpOnly cookie. The
 * refresh token never reaches the page. A failed refresh clears the cookie,
 * so the page asks the user to connect again.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Tokens from a PKCE login refresh with the client ID alone, no secret.
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const refreshToken = storedRefreshToken(request);
  if (!refreshToken) {
    return signedOut(request, 'Not connected');
  }

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    }),
  }).catch(() => null);

  if (!res?.ok) {
    console.error('[spotify/refresh] failed:', res?.status ?? 'network error');
    return signedOut(request, 'Token refresh failed');
  }

  const data = await res.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown } | null;
  if (typeof data?.access_token !== 'string' || typeof data.expires_in !== 'number') {
    console.error('[spotify/refresh] unexpected response');
    return signedOut(request, 'Token refresh failed');
  }

  const response = NextResponse.json({ access_token: data.access_token, expires_in: data.expires_in });
  // Spotify may rotate the refresh token. The cookie keeps whichever is current, and is renewed either way.
  const next = typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken;
  response.cookies.set(REFRESH_COOKIE, next, refreshCookie(request));
  return response;
}

function signedOut(request: NextRequest, error: string) {
  const response = NextResponse.json({ error }, { status: 401 });
  response.cookies.set(REFRESH_COOKIE, '', refreshCookie(request, 0));
  return response;
}
