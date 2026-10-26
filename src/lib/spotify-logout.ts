/**
 * Set while a Spotify disconnect has not reached the server, so the next page
 * load tries again. The refresh token's cookie is httpOnly: only the server can
 * clear it, so a disconnect is finished only when the server says so.
 */
export const LOGOUT_PENDING_KEY = 'sahurlock.spotify.logout_pending';

/**
 * The Web Lock that orders token refreshes and disconnects across tabs, so a
 * disconnect is sent only after a refresh already running has finished, and
 * that refresh cannot set the cookie again after it.
 */
export const SPOTIFY_TOKEN_LOCK = 'sahurlock-spotify-refresh';

/** Run `task` under the token lock where the browser has Web Locks, else at once. */
export function withTokenLock<T>(task: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    // The lock resolves with the task's own result. The DOM typing nests the promise.
    ? (navigator.locks.request(SPOTIFY_TOKEN_LOCK, task) as unknown as Promise<T>)
    : task();
}

const setPending = (pending: boolean) => {
  try {
    if (pending) localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    else localStorage.removeItem(LOGOUT_PENDING_KEY);
  } catch { /* storage may be unavailable */ }
};

/**
 * Ask the server to clear the Spotify login, and resolve true once it has.
 * The pending mark is set at once, so if the tab closes before the request
 * goes, a later load still sends it. The request waits for the token lock and
 * uses keepalive, so it outlasts the tab. Until it succeeds, the mark stays,
 * and finishPendingLogout tries again.
 */
export function clearSpotifyLogin(): Promise<boolean> {
  setPending(true);
  return withTokenLock(async () => {
    try {
      const res = await fetch('/api/spotify/logout', { method: 'POST', keepalive: true });
      if (res.status !== 204) return false;
    } catch {
      return false;
    }
    setPending(false);
    return true;
  });
}

/** Whether a disconnect is still waiting for the server. */
export function logoutPending(): boolean {
  try {
    return localStorage.getItem(LOGOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

/** Forget a pending disconnect, because a new login has replaced the cookie it was for. */
export function cancelPendingLogout(): void {
  setPending(false);
}

/**
 * Finish a disconnect that an earlier page could not, for example one made
 * offline. A page that arrives with a new login's token in its address has a
 * new cookie, which the old disconnect must not clear.
 */
export function finishPendingLogout(): void {
  if (!logoutPending()) return;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.hash.slice(1)).has('spotify_access_token')) {
    cancelPendingLogout();
    return;
  }
  void clearSpotifyLogin();
}
