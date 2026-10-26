import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookie, redirectUri as spotifyRedirectUri } from '@/lib/spotify-server';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const storedState = request.cookies.get('spotify_auth_state')?.value;
  const verifier    = request.cookies.get('spotify_code_verifier')?.value;

  // ── Guard: OAuth error or state mismatch ──────────────────────────────────
  if (error) {
    return redirectToSession(origin, null, 'access_denied');
  }
  if (!code || !state || state !== storedState || !verifier) {
    return redirectToSession(origin, null, 'state_mismatch');
  }

  // ── Exchange code for tokens ──────────────────────────────────────────────
  // PKCE: the verifier stands in for a client secret, so none is configured.
  const clientId    = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = spotifyRedirectUri(request);

  if (!clientId) {
    return redirectToSession(origin, null, 'server_misconfigured');
  }

  let tokenData: { access_token: string; refresh_token: string; expires_in: number };
  try {
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[spotify/callback] token exchange failed:', res.status, body);
      return redirectToSession(origin, null, 'token_exchange_failed');
    }

    const data = await res.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.expires_in !== 'number') {
      console.error('[spotify/callback] unexpected token response');
      return redirectToSession(origin, null, 'token_exchange_failed');
    }
    tokenData = { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
  } catch (err) {
    console.error('[spotify/callback] fetch error:', err);
    return redirectToSession(origin, null, 'token_exchange_failed');
  }

  // ── Hand over the tokens ──────────────────────────────────────────────────
  // The short-lived access token goes to the page in the URL hash, which is never
  // sent to a server and stays out of access logs. The Web Playback SDK needs it
  // in the page. The refresh token stays in an httpOnly cookie that no script can
  // read, and only /api/spotify/refresh uses it.
  const response = redirectToSession(origin, tokenData);
  response.cookies.set(REFRESH_COOKIE, tokenData.refresh_token, refreshCookie(request));
  response.cookies.delete('spotify_auth_state');
  response.cookies.delete('spotify_code_verifier');
  return response;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function redirectToSession(
  origin: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number } | null,
  errorCode?: string
): NextResponse {
  if (!tokens) {
    const url = new URL('/spotify/callback', origin);
    url.searchParams.set('error', errorCode ?? 'unknown');
    return NextResponse.redirect(url.toString());
  }

  const hashParams = new URLSearchParams({
    spotify_access_token: tokens.access_token,
    spotify_expires_in:   String(tokens.expires_in),
  });

  // NextResponse.redirect follows the Location header; the browser appends the
  // hash client-side — the server never sees the fragment.
  return NextResponse.redirect(`${origin}/spotify/callback#${hashParams.toString()}`);
}
