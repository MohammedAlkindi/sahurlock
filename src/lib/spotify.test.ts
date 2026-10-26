import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyService } from './spotify';
import { LOGOUT_PENDING_KEY } from './spotify-logout';
import { MemoryStorage } from './memory-storage';

const ACCESS = 'sahurlock.spotify.access_token';
const EXPIRY = 'sahurlock.spotify.token_expiry';
const OLD_REFRESH = 'sahurlock.spotify.refresh_token';

type Call = { url: string; init?: RequestInit };
let calls: Call[];
/** Answers for /api/spotify/refresh, taken in order. */
let refreshAnswers: (() => Promise<Response>)[];

/** A fresh service, as on a new page load, over the storage the test set up. */
function freshService() {
  (SpotifyService as unknown as { _instance: SpotifyService | null })._instance = null;
  return SpotifyService.getInstance();
}

/** A token that has expired, so the next call refreshes. */
function storeExpiredToken() {
  localStorage.setItem(ACCESS, 'at1');
  localStorage.setItem(EXPIRY, String(Date.now() - 1000));
}

const tokenResponse = (token: string) => new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('window', { location: { hash: '', pathname: '/spotify/callback', search: '' } });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('navigator', {});
  calls = [];
  refreshAnswers = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/spotify/refresh') return (refreshAnswers.shift() ?? (async () => new Response(null, { status: 401 })))();
    return new Response(null, { status: 204 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const posted = (url: string) => calls.filter((c) => c.url === url).length;

describe('SpotifyService tokens', () => {
  it('drops a refresh token an older version kept in the page', () => {
    localStorage.setItem(OLD_REFRESH, 'rt');
    freshService();
    expect(localStorage.getItem(OLD_REFRESH)).toBeNull();
  });

  it('keeps only the access token from the login redirect, and cancels a pending disconnect', () => {
    localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    (window as unknown as { location: { hash: string } }).location.hash = '#spotify_access_token=at&spotify_expires_in=3600';
    const service = freshService();
    expect(service.handleHashCallback()).toBe(true);
    expect(localStorage.getItem(ACCESS)).toBe('at');
    expect(localStorage.getItem(LOGOUT_PENDING_KEY)).toBeNull();
  });

  it('disconnects through the server, which alone can clear the cookie', async () => {
    storeExpiredToken();
    const service = freshService();
    service.logout();
    expect(localStorage.getItem(ACCESS)).toBeNull();
    await vi.waitFor(() => expect(posted('/api/spotify/logout')).toBe(1));
    expect(calls[0].init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('refreshes once when several callers need a token at the same time', async () => {
    storeExpiredToken();
    let answer!: (r: Response) => void;
    refreshAnswers.push(() => new Promise((resolve) => { answer = resolve; }));
    const service = freshService();
    const both = Promise.all([service.getValidToken(), service.getValidToken()]);
    await vi.waitFor(() => expect(posted('/api/spotify/refresh')).toBe(1));
    answer(tokenResponse('at2'));
    expect(await both).toEqual(['at2', 'at2']);
    expect(posted('/api/spotify/refresh')).toBe(1);
  });

  it('refreshes under a Web Lock, so tabs take turns', async () => {
    storeExpiredToken();
    refreshAnswers.push(async () => tokenResponse('at2'));
    const request = vi.fn((_name: string, run: () => Promise<string | null>) => run());
    vi.stubGlobal('navigator', { locks: { request } });
    expect(await freshService().getValidToken()).toBe('at2');
    expect(request).toHaveBeenCalledWith('sahurlock-spotify-refresh', expect.any(Function));
  });

  it('uses the token another tab refreshed while this one waited for the lock', async () => {
    storeExpiredToken();
    const service = freshService();
    // The other tab finishes first and stores a fresh token.
    const request = vi.fn(async (_name: string, run: () => Promise<string | null>) => {
      localStorage.setItem(ACCESS, 'at-other-tab');
      localStorage.setItem(EXPIRY, String(Date.now() + 3_600_000));
      return run();
    });
    vi.stubGlobal('navigator', { locks: { request } });
    expect(await service.getValidToken()).toBe('at-other-tab');
    expect(posted('/api/spotify/refresh')).toBe(0);
  });

  it('drops a refresh that ends after a disconnect, and asks the server again to clear the cookie', async () => {
    storeExpiredToken();
    let answer!: (r: Response) => void;
    refreshAnswers.push(() => new Promise((resolve) => { answer = resolve; }));
    const service = freshService();
    const token = service.getValidToken();
    await vi.waitFor(() => expect(posted('/api/spotify/refresh')).toBe(1));
    service.logout();
    answer(tokenResponse('at2'));
    expect(await token).toBeNull();
    expect(service.isConnected).toBe(false);
    expect(localStorage.getItem(ACCESS)).toBeNull();
    await vi.waitFor(() => expect(posted('/api/spotify/logout')).toBe(2));
  });

  it('disconnects when another tab has disconnected', async () => {
    storeExpiredToken();
    const service = freshService();
    const events: unknown[] = [];
    service.subscribe((e) => events.push(e));
    localStorage.removeItem(ACCESS);
    expect(await service.getValidToken()).toBeNull();
    expect(posted('/api/spotify/refresh')).toBe(0);
    expect(events).toContainEqual({ type: 'auth_changed', connected: false });
  });

  it('disconnects when the server refuses the refresh', async () => {
    storeExpiredToken();
    const service = freshService();
    expect(await service.getValidToken()).toBeNull();
    expect(service.isConnected).toBe(false);
  });
});

/** A Web Lock that runs one request at a time, in order, as the browser does across tabs. */
function serialLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: (_name: string, run: () => Promise<unknown>) => {
      const result = tail.then(run);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

describe('SpotifyService across tabs', () => {
  it('a disconnect in one tab while another refreshes leaves no cookie and no token', async () => {
    storeExpiredToken();
    vi.stubGlobal('navigator', { locks: serialLocks() });
    // The server's cookie, as the routes set and clear it.
    let cookie: string | null = 'rt1';
    let answer!: () => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/spotify/logout') { cookie = null; return new Response(null, { status: 204 }); }
      // The refresh renews the cookie when its answer arrives, after Spotify replies.
      await new Promise<void>((resolve) => { answer = resolve; });
      cookie = 'rt1';
      return tokenResponse('at2');
    }));
    const newTab = () => new (SpotifyService as unknown as new () => SpotifyService)();
    const tabA = newTab();
    const tabB = newTab();

    const refreshing = tabB.getValidToken();
    await vi.waitFor(() => expect(posted('/api/spotify/refresh')).toBe(1));
    tabA.logout();
    answer();
    expect(await refreshing).toBeNull();
    await vi.waitFor(() => expect(localStorage.getItem(LOGOUT_PENDING_KEY)).toBeNull());

    // The disconnect went after the refresh, so it cleared the cookie the refresh renewed.
    expect(cookie).toBeNull();
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(tabB.isConnected).toBe(false);
    expect(newTab().isConnected).toBe(false);
  });
});
