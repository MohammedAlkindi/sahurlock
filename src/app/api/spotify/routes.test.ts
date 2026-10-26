import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as login } from '@/app/api/spotify/login/route';
import { GET as callback } from '@/app/api/spotify/callback/route';
import { POST as refresh } from '@/app/api/spotify/refresh/route';
import { POST as logout } from '@/app/api/spotify/logout/route';
import { codeChallenge } from '@/lib/pkce';

const ORIGIN = 'http://localhost:3000';

type Sent = { url: string; headers: Headers; body: URLSearchParams };

function mockTokenEndpoint(response: object, status = 200) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: new Headers(init.headers), body: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(response), { status });
  }));
  return sent;
}

beforeEach(() => {
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-123');
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('sends an S256 challenge and keeps the verifier in an httpOnly cookie', () => {
    const res = login(new NextRequest(`${ORIGIN}/api/spotify/login`));
    const authorize = new URL(res.headers.get('location') ?? '');
    const verifier = res.cookies.get('spotify_code_verifier');

    expect(authorize.origin + authorize.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(verifier?.httpOnly).toBe(true);
    expect(authorize.searchParams.get('code_challenge')).toBe(codeChallenge(verifier?.value ?? ''));
    expect(authorize.searchParams.get('state')).toBe(res.cookies.get('spotify_auth_state')?.value);
    expect(verifier?.secure).toBe(false);
  });

  it('marks its cookies Secure over HTTPS', () => {
    const res = login(new NextRequest('https://sahurlock.example/api/spotify/login'));
    expect(res.cookies.get('spotify_code_verifier')?.secure).toBe(true);
    expect(res.cookies.get('spotify_auth_state')?.secure).toBe(true);
  });
});

describe('callback', () => {
  const request = (cookies: string) =>
    new NextRequest(`${ORIGIN}/api/spotify/callback?code=abc&state=s1`, { headers: { cookie: cookies } });

  it('exchanges the code with the verifier and no secret', async () => {
    const sent = mockTokenEndpoint({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
    const res = await callback(request('spotify_auth_state=s1; spotify_code_verifier=v1'));

    expect(sent).toHaveLength(1);
    expect(sent[0].headers.has('authorization')).toBe(false);
    expect(Object.fromEntries(sent[0].body)).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: `${ORIGIN}/api/spotify/callback`,
      client_id: 'client-123',
      code_verifier: 'v1',
    });
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/spotify/callback#spotify_access_token=at');
    expect(res.cookies.get('spotify_code_verifier')?.value).toBe('');
    // The refresh token never reaches the page: it goes into an httpOnly cookie for the refresh route only.
    expect(location).not.toContain('refresh');
    expect(res.cookies.get('spotify_refresh')).toMatchObject({ value: 'rt', httpOnly: true, sameSite: 'strict', path: '/api/spotify' });
  });

  it('refuses a token response without a refresh token', async () => {
    mockTokenEndpoint({ access_token: 'at', expires_in: 3600 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callback(request('spotify_auth_state=s1; spotify_code_verifier=v1'));
    expect(res.headers.get('location')).toContain('error=token_exchange_failed');
    expect(res.cookies.get('spotify_refresh')).toBeUndefined();
  });

  it('refuses a callback without the verifier cookie', async () => {
    const sent = mockTokenEndpoint({});
    const res = await callback(request('spotify_auth_state=s1'));
    expect(sent).toHaveLength(0);
    expect(res.headers.get('location')).toContain('error=state_mismatch');
  });
});

/** A POST from a page on this site, carrying these cookies. */
const post = (path: string, cookie = '', origin: string | null = ORIGIN) => new NextRequest(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { host: 'localhost:3000', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
});

describe('refresh', () => {
  it('refreshes with the cookie and the client ID, and returns no refresh token', async () => {
    const sent = mockTokenEndpoint({ access_token: 'at2', expires_in: 3600 });
    const res = await refresh(post('/api/spotify/refresh', 'spotify_refresh=rt'));

    expect(res.status).toBe(200);
    expect(sent[0].headers.has('authorization')).toBe(false);
    expect(Object.fromEntries(sent[0].body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'client-123' });
    expect(await res.json()).toEqual({ access_token: 'at2', expires_in: 3600 });
    // Renewed, so a token in daily use does not expire with its cookie.
    expect(res.cookies.get('spotify_refresh')).toMatchObject({ value: 'rt', httpOnly: true, path: '/api/spotify' });
  });

  it('keeps the new refresh token when Spotify rotates it', async () => {
    mockTokenEndpoint({ access_token: 'at2', expires_in: 3600, refresh_token: 'rt2' });
    const res = await refresh(post('/api/spotify/refresh', 'spotify_refresh=rt'));
    expect(res.cookies.get('spotify_refresh')?.value).toBe('rt2');
    expect(await res.json()).not.toHaveProperty('refresh_token');
  });

  it('reports a failed refresh and clears the cookie so the page asks to connect again', async () => {
    mockTokenEndpoint({ error: 'invalid_grant' }, 400);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await refresh(post('/api/spotify/refresh', 'spotify_refresh=old'));
    expect(res.status).toBe(401);
    expect(res.cookies.get('spotify_refresh')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('asks Spotify nothing without a refresh token cookie, or with one too long to be real', async () => {
    const sent = mockTokenEndpoint({ access_token: 'at2', expires_in: 3600 });
    expect((await refresh(post('/api/spotify/refresh'))).status).toBe(401);
    expect((await refresh(post('/api/spotify/refresh', `spotify_refresh=${'x'.repeat(2000)}`))).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('refuses a request from another site or with no Origin', async () => {
    const sent = mockTokenEndpoint({ access_token: 'at2', expires_in: 3600 });
    expect((await refresh(post('/api/spotify/refresh', 'spotify_refresh=rt', 'https://evil.example'))).status).toBe(403);
    expect((await refresh(post('/api/spotify/refresh', 'spotify_refresh=rt', null))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe('logout', () => {
  it('clears the refresh token cookie', async () => {
    const res = logout(post('/api/spotify/logout', 'spotify_refresh=rt'));
    expect(res.status).toBe(204);
    expect(res.cookies.get('spotify_refresh')).toMatchObject({ value: '', maxAge: 0, path: '/api/spotify' });
  });

  it('refuses a request from another site', () => {
    expect(logout(post('/api/spotify/logout', 'spotify_refresh=rt', 'https://evil.example')).status).toBe(403);
  });
});
