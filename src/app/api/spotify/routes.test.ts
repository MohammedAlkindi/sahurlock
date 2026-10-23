import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as login } from '@/app/api/spotify/login/route';
import { GET as callback } from '@/app/api/spotify/callback/route';
import { POST as refresh } from '@/app/api/spotify/refresh/route';
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
    expect(res.headers.get('location')).toContain('/spotify/callback#spotify_access_token=at');
    expect(res.cookies.get('spotify_code_verifier')?.value).toBe('');
  });

  it('refuses a callback without the verifier cookie', async () => {
    const sent = mockTokenEndpoint({});
    const res = await callback(request('spotify_auth_state=s1'));
    expect(sent).toHaveLength(0);
    expect(res.headers.get('location')).toContain('error=state_mismatch');
  });
});

describe('refresh', () => {
  it('refreshes with the client ID and no secret', async () => {
    const sent = mockTokenEndpoint({ access_token: 'at2', expires_in: 3600 });
    const res = await refresh(new NextRequest(`${ORIGIN}/api/spotify/refresh`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'rt' }),
    }));

    expect(res.status).toBe(200);
    expect(sent[0].headers.has('authorization')).toBe(false);
    expect(Object.fromEntries(sent[0].body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'client-123' });
  });

  it('reports a failed refresh so the client signs out', async () => {
    mockTokenEndpoint({ error: 'invalid_grant' }, 400);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await refresh(new NextRequest(`${ORIGIN}/api/spotify/refresh`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'old' }),
    }));
    expect(res.status).toBe(401);
  });
});
