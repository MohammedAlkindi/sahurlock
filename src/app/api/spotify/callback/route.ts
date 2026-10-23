import { NextRequest, NextResponse } from 'next/server';

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
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${origin}/api/spotify/callback`;

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

    tokenData = await res.json();
  } catch (err) {
    console.error('[spotify/callback] fetch error:', err);
    return redirectToSession(origin, null, 'token_exchange_failed');
  }

  // ── Pass tokens to the client via URL hash fragment ───────────────────────
  // Hash fragments are never sent to the server and do not appear in server
  // access logs, making this a safe transport for short-lived tokens.
  const response = redirectToSession(origin, tokenData);
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
    spotify_access_token:  tokens.access_token,
    spotify_refresh_token: tokens.refresh_token,
    spotify_expires_in:    String(tokens.expires_in),
  });

  // NextResponse.redirect follows the Location header; the browser appends the
  // hash client-side — the server never sees the fragment.
  return NextResponse.redirect(`${origin}/spotify/callback#${hashParams.toString()}`);
}
