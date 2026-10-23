import { NextRequest, NextResponse } from 'next/server';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function POST(request: NextRequest) {
  // Tokens from a PKCE login refresh with the client ID alone, no secret.
  const clientId = process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let refreshToken: string;
  try {
    const body = await request.json() as { refresh_token?: string };
    refreshToken = body.refresh_token ?? '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!refreshToken) {
    return NextResponse.json({ error: 'refresh_token is required' }, { status: 400 });
  }

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[spotify/refresh] failed:', res.status, text);
    return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
  }

  const data = await res.json() as {
    access_token: string;
    expires_in: number;
    refresh_token?: string; // Spotify may rotate the refresh token
  };

  return NextResponse.json({
    access_token:  data.access_token,
    expires_in:    data.expires_in,
    refresh_token: data.refresh_token, // may be undefined — client keeps the old one
  });
}
