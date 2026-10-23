import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { codeChallenge, createCodeVerifier } from '@/lib/pkce';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

export function GET(request: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'SPOTIFY_CLIENT_ID is not configured.' },
      { status: 500 }
    );
  }

  const origin      = new URL(request.url).origin;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${origin}/api/spotify/callback`;
  const state       = randomBytes(16).toString('hex');
  const verifier    = createCodeVerifier();

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          redirectUri,
    scope:                 SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge:        codeChallenge(verifier),
  });

  const response = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params}`
  );

  // State checks the callback against CSRF. The verifier finishes the PKCE
  // exchange. Both stay in httpOnly cookies for the 10 minutes a login may take.
  const cookie = { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' } as const;
  response.cookies.set('spotify_auth_state', state, cookie);
  response.cookies.set('spotify_code_verifier', verifier, cookie);

  return response;
}
