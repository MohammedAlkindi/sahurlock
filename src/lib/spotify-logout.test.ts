import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './memory-storage';
import { cancelPendingLogout, clearSpotifyLogin, finishPendingLogout, LOGOUT_PENDING_KEY, logoutPending } from './spotify-logout';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('clearSpotifyLogin', () => {
  it('asks the server to clear the cookie, in a request that outlives the tab, and forgets the mark once it has', async () => {
    expect(await clearSpotifyLogin()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/spotify/logout', { method: 'POST', keepalive: true });
    expect(logoutPending()).toBe(false);
  });

  it('keeps the mark when the request fails or is refused, so a later load tries again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await clearSpotifyLogin()).toBe(false);
    expect(localStorage.getItem(LOGOUT_PENDING_KEY)).toBe('1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await clearSpotifyLogin()).toBe(false);
    expect(logoutPending()).toBe(true);
  });
});

describe('clearSpotifyLogin and the token lock', () => {
  it('marks the disconnect pending at once, and sends it only after a refresh holding the lock is done', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let tail: Promise<unknown> = held;
    vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => Promise<unknown>) => (tail = tail.then(run)) } });
    const done = clearSpotifyLogin();
    expect(logoutPending()).toBe(true);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    expect(await done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('finishPendingLogout', () => {
  it('finishes a disconnect an earlier page could not', async () => {
    localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    finishPendingLogout();
    await vi.waitFor(() => expect(logoutPending()).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no disconnect is waiting', () => {
    finishPendingLogout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is cancelled on the page a new login arrives on, whose cookie it must not clear', () => {
    localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    vi.stubGlobal('window', { location: { hash: '#spotify_access_token=at&spotify_expires_in=3600' } });
    finishPendingLogout();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logoutPending()).toBe(false);
  });

  it('is cancelled by a new login, whose cookie replaced the one it was for', () => {
    localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    cancelPendingLogout();
    finishPendingLogout();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
