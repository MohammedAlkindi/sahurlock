import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookie, sameOrigin } from '@/lib/spotify-server';

/** Forget the Spotify refresh token by clearing its httpOnly cookie, which the page cannot do itself. */
export function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(REFRESH_COOKIE, '', refreshCookie(request, 0));
  return response;
}
