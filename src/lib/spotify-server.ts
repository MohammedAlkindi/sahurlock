import type { NextRequest } from 'next/server';

/**
 * The cookie that holds the Spotify refresh token. It is httpOnly, so no
 * script on the page can read it, and it is sent only to the Spotify routes.
 */
export const REFRESH_COOKIE = 'spotify_refresh';

/** Spotify refresh tokens last until revoked. Each refresh renews the cookie. */
const REFRESH_MAX_AGE = 60 * 60 * 24 * 180;

/** Longer than any refresh token Spotify issues, so a padded or junk cookie is refused unsent. */
const MAX_TOKEN_LENGTH = 1024;

/** Whether the request reached the app over HTTPS, so its cookies can be marked Secure. */
export const isHttps = (request: NextRequest) => new URL(request.url).protocol === 'https:';

/** Options for the refresh token cookie. Pass maxAge 0 to clear it. */
export const refreshCookie = (request: NextRequest, maxAge = REFRESH_MAX_AGE) =>
  ({ httpOnly: true, secure: isHttps(request), sameSite: 'strict', path: '/api/spotify', maxAge } as const);

/**
 * Whether a POST came from a page on this site. Browsers always send Origin
 * on a POST made with fetch, so a missing or foreign one is refused.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The refresh token from its cookie, or null when there is none or it cannot be one. */
export function storedRefreshToken(request: NextRequest): string | null {
  const token = request.cookies.get(REFRESH_COOKIE)?.value ?? '';
  return token && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

const CALLBACK_PATH = '/api/spotify/callback';

/**
 * Where Spotify sends the user back after login. SPOTIFY_REDIRECT_URI pins one
 * address for every alias of the deployment, but only when it is a single
 * absolute URL to the callback route. Anything else, such as several lines or
 * another route, would make Spotify refuse the login, so this origin's callback
 * is used and the problem is logged. Spotify accepts only an address registered
 * for the app in its dashboard.
 */
export function redirectUri(request: NextRequest): string {
  const own = `${new URL(request.url).origin}${CALLBACK_PATH}`;
  const configured = process.env.SPOTIFY_REDIRECT_URI;
  if (!configured) return own;
  try {
    const url = new URL(configured);
    if (!/\s/.test(configured) && url.pathname === CALLBACK_PATH && !url.search && !url.hash) return url.toString();
  } catch { /* not a URL */ }
  console.error('[spotify] SPOTIFY_REDIRECT_URI is not one URL to /api/spotify/callback, so this origin is used');
  return own;
}
