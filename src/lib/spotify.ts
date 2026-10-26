// ── Spotify types ──────────────────────────────────────────────────────────────

export interface SpotifyProfile {
  id: string;
  display_name: string;
  email: string;
  product: 'premium' | 'free' | 'open';
  images: { url: string; width: number; height: number }[];
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: {
    name: string;
    images: { url: string; width: number; height: number }[];
  };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  uri: string;
  images: { url: string; width: number; height: number }[];
  tracks: { total: number };
  owner: { display_name: string };
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyTrack | null;
  device: SpotifyDevice;
  repeat_state: 'off' | 'context' | 'track';
  shuffle_state: boolean;
}

export interface SpotifySearchResults {
  tracks: { items: SpotifyTrack[] };
  playlists: { items: SpotifyPlaylist[] };
}

export type SpotifyEvent =
  | { type: 'state_changed'; state: SpotifyPlaybackState | null }
  | { type: 'device_ready'; deviceId: string }
  | { type: 'device_lost' }
  | { type: 'error'; message: string }
  | { type: 'auth_changed'; connected: boolean };

type EventListener = (event: SpotifyEvent) => void;

// ── Storage keys ───────────────────────────────────────────────────────────────

const KEYS = {
  ACCESS_TOKEN:  'sahurlock.spotify.access_token',
  REFRESH_TOKEN: 'sahurlock.spotify.refresh_token',
  TOKEN_EXPIRY:  'sahurlock.spotify.token_expiry',
} as const;

const SPOTIFY_API = 'https://api.spotify.com/v1';

// ── SpotifyService ─────────────────────────────────────────────────────────────

export class SpotifyService {
  private static _instance: SpotifyService | null = null;

  private _accessToken: string | null = null;
  private _tokenExpiry = 0; // unix ms

  private _player: Spotify.Player | null = null;
  private _deviceId: string | null = null;
  private _playerReady = false;

  private _listeners: Set<EventListener> = new Set();

  static getInstance(): SpotifyService {
    if (!SpotifyService._instance) {
      SpotifyService._instance = new SpotifyService();
    }
    return SpotifyService._instance;
  }

  private constructor() {
    if (typeof window !== 'undefined') {
      this._loadFromStorage();
    }
  }

  // ── Event bus ────────────────────────────────────────────────────────────────

  subscribe(listener: EventListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _emit(event: SpotifyEvent) {
    this._listeners.forEach((l) => l(event));
  }

  // ── Auth state ───────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return !!this._accessToken;
  }

  get deviceId(): string | null {
    return this._deviceId;
  }

  get playerReady(): boolean {
    return this._playerReady;
  }

  // ── Token storage ────────────────────────────────────────────────────────────

  private _loadFromStorage() {
    try {
      this._accessToken  = localStorage.getItem(KEYS.ACCESS_TOKEN);
      this._tokenExpiry  = Number(localStorage.getItem(KEYS.TOKEN_EXPIRY) ?? 0);
      // The refresh token now lives in an httpOnly cookie. Drop a copy an older version stored here.
      localStorage.removeItem(KEYS.REFRESH_TOKEN);
    } catch {
      // localStorage may be unavailable (SSR, privacy mode)
    }
  }

  private _saveToStorage() {
    try {
      if (this._accessToken)  localStorage.setItem(KEYS.ACCESS_TOKEN,  this._accessToken);
      localStorage.setItem(KEYS.TOKEN_EXPIRY, String(this._tokenExpiry));
    } catch { /* ignore */ }
  }

  private _clearStorage() {
    try {
      localStorage.removeItem(KEYS.ACCESS_TOKEN);
      localStorage.removeItem(KEYS.REFRESH_TOKEN);
      localStorage.removeItem(KEYS.TOKEN_EXPIRY);
    } catch { /* ignore */ }
  }

  // ── OAuth helpers ────────────────────────────────────────────────────────────

  /** Redirect the browser to the Spotify OAuth login page via our server route. */
  login() {
    window.location.href = '/api/spotify/login';
  }

  logout() {
    this._destroyPlayer();
    this._accessToken  = null;
    this._tokenExpiry  = 0;
    this._clearStorage();
    // The refresh token's cookie is httpOnly, so only the server can clear it.
    fetch('/api/spotify/logout', { method: 'POST' }).catch(() => {});
    this._emit({ type: 'auth_changed', connected: false });
  }

  /**
   * Called on the session page mount to consume OAuth tokens from the URL hash.
   * Returns true if tokens were successfully parsed and saved.
   */
  handleHashCallback(): boolean {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash.slice(1);
    if (!hash.includes('spotify_access_token')) return false;

    const params = new URLSearchParams(hash);
    const accessToken  = params.get('spotify_access_token');
    const expiresIn    = Number(params.get('spotify_expires_in') ?? 3600);

    if (!accessToken) return false;

    this._accessToken  = accessToken;
    this._tokenExpiry  = Date.now() + expiresIn * 1000 - 60_000; // 1min early margin
    this._saveToStorage();

    // Remove Spotify tokens from URL without adding a history entry
    const clean = window.location.pathname + window.location.search;
    history.replaceState(null, '', clean);

    this._emit({ type: 'auth_changed', connected: true });
    return true;
  }

  // ── Token refresh ─────────────────────────────────────────────────────────────

  /** A new access token from the server, which holds the refresh token in an httpOnly cookie. */
  private async _refreshAccessToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/spotify/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json() as { access_token: string; expires_in: number };
      this._accessToken = data.access_token;
      this._tokenExpiry = Date.now() + data.expires_in * 1000 - 60_000;
      this._saveToStorage();
      return this._accessToken;
    } catch {
      // Refresh failed — force re-login
      this.logout();
      return null;
    }
  }

  /** Returns a valid access token, refreshing if needed. */
  async getValidToken(): Promise<string | null> {
    if (!this._accessToken) return null;
    if (Date.now() < this._tokenExpiry) return this._accessToken;
    return this._refreshAccessToken();
  }

  // ── Web Playback SDK ──────────────────────────────────────────────────────────

  private _loadSDK(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window.Spotify !== 'undefined') { resolve(); return; }

      const prev = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof prev === 'function') prev();
        resolve();
      };

      if (!document.getElementById('spotify-sdk-script')) {
        const script = document.createElement('script');
        script.id  = 'spotify-sdk-script';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        document.body.appendChild(script);
      }
    });
  }

  async initPlayer(): Promise<void> {
    if (this._player) return;

    const token = await this.getValidToken();
    if (!token) {
      this._emit({ type: 'error', message: 'Not authenticated' });
      return;
    }

    await this._loadSDK();

    this._player = new window.Spotify.Player({
      name: 'SahurLock',
      getOAuthToken: async (cb) => {
        const t = await this.getValidToken();
        if (t) cb(t);
      },
      volume: 0.7,
    });

    this._player.addListener('ready', ({ device_id }: { device_id: string }) => {
      this._deviceId  = device_id;
      this._playerReady = true;
      this._emit({ type: 'device_ready', deviceId: device_id });
    });

    this._player.addListener('not_ready', () => {
      this._playerReady = false;
      this._emit({ type: 'device_lost' });
    });

    this._player.addListener('player_state_changed', (state: Spotify.PlaybackState | null) => {
      if (!state) {
        this._emit({ type: 'state_changed', state: null });
        return;
      }
      const track = state.track_window.current_track;
      const mapped: SpotifyPlaybackState = {
        is_playing: !state.paused,
        progress_ms: state.position,
        item: track
          ? {
              id:          track.id ?? '',
              name:        track.name,
              uri:         track.uri,
              duration_ms: track.duration_ms,
              artists:     track.artists.map((a) => ({ id: a.uri, name: a.name })),
              album: {
                name:   track.album.name,
                images: track.album.images,
              },
            }
          : null,
        device: {
          id:             this._deviceId ?? '',
          name:           'SahurLock',
          type:           'Computer',
          is_active:      true,
          volume_percent: Math.round(state.track_window.current_track?.duration_ms ?? 70),
        },
        repeat_state:  'off',
        shuffle_state: false,
      };
      this._emit({ type: 'state_changed', state: mapped });
    });

    this._player.addListener('authentication_error', () => {
      this._emit({ type: 'error', message: 'Spotify authentication error. Please reconnect.' });
      this.logout();
    });

    this._player.addListener('account_error', () => {
      this._emit({ type: 'error', message: 'Spotify Premium is required for playback.' });
    });

    this._player.addListener('playback_error', ({ message }: { message: string }) => {
      this._emit({ type: 'error', message: `Playback error: ${message}` });
    });

    await this._player.connect();
  }

  private _destroyPlayer() {
    if (this._player) {
      this._player.disconnect();
      this._player     = null;
      this._deviceId   = null;
      this._playerReady = false;
    }
  }

  // ── API helpers ───────────────────────────────────────────────────────────────

  private async _api<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: object
  ): Promise<T> {
    const token = await this.getValidToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.logout();
      throw new Error('Session expired. Please reconnect Spotify.');
    }

    if (res.status === 403) {
      throw new Error('Spotify Premium required for this action.');
    }

    if (res.status === 204 || res.status === 202) {
      return undefined as T;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Spotify API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async getProfile(): Promise<SpotifyProfile> {
    return this._api<SpotifyProfile>('GET', '/me');
  }

  async search(query: string, types = ['track', 'playlist'], limit = 5): Promise<SpotifySearchResults> {
    const params = new URLSearchParams({
      q:     query,
      type:  types.join(','),
      limit: String(limit),
    });
    return this._api<SpotifySearchResults>('GET', `/search?${params}`);
  }

  async getPlaybackState(): Promise<SpotifyPlaybackState | null> {
    const data = await this._api<SpotifyPlaybackState | null>('GET', '/me/player');
    return data ?? null;
  }

  /** Transfer playback to the in-browser Playback SDK device. */
  async transferToPlayer(): Promise<void> {
    if (!this._deviceId) throw new Error('Player device not ready');
    await this._api('PUT', '/me/player', {
      device_ids: [this._deviceId],
      play: false,
    });
  }

  async play(options?: { context_uri?: string; uris?: string[]; offset?: { uri: string } }): Promise<void> {
    const deviceQuery = this._deviceId ? `?device_id=${this._deviceId}` : '';
    await this._api('PUT', `/me/player/play${deviceQuery}`, options ?? {});
  }

  async pause(): Promise<void> {
    const deviceQuery = this._deviceId ? `?device_id=${this._deviceId}` : '';
    await this._api('PUT', `/me/player/pause${deviceQuery}`);
  }

  async next(): Promise<void> {
    const deviceQuery = this._deviceId ? `?device_id=${this._deviceId}` : '';
    await this._api('POST', `/me/player/next${deviceQuery}`);
  }

  async previous(): Promise<void> {
    const deviceQuery = this._deviceId ? `?device_id=${this._deviceId}` : '';
    await this._api('POST', `/me/player/previous${deviceQuery}`);
  }

  async setVolume(percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const deviceQuery = this._deviceId ? `&device_id=${this._deviceId}` : '';
    await this._api('PUT', `/me/player/volume?volume_percent=${clamped}${deviceQuery}`);
  }

  async getUserPlaylists(limit = 10): Promise<SpotifyPlaylist[]> {
    const data = await this._api<{ items: SpotifyPlaylist[] }>('GET', `/me/playlists?limit=${limit}`);
    return data.items;
  }
}
