'use client';

import { useEffect, useRef, useState } from 'react';
import { useSpotify } from '@/hooks/use-spotify';
import { SpotifyPlaylist, SpotifyTrack } from '@/lib/spotify';

// ── Icon primitives (inline SVG, no extra deps) ────────────────────────────────

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  spotify:  'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z',
  play:     'M8 5v14l11-7z',
  pause:    'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next:     'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev:     'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  search:   'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  volume:   'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  close:    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  music:    'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  transfer: 'M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z',
  chevDown: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  chevUp:   'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function SpotifyLogo({ size = 18 }: { size?: number }) {
  return <Icon d={ICONS.spotify} size={size} />;
}

function TrackArt({ images, size = 40 }: { images: { url: string }[]; size?: number }) {
  const src = images?.[0]?.url;
  if (!src) {
    return (
      <div
        className="rounded bg-muted flex items-center justify-center text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <Icon d={ICONS.music} size={size * 0.5} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className="rounded object-cover" style={{ width: size, height: size }} />;
}

function ControlBtn({
  onClick,
  disabled,
  iconD,
  size = 16,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  iconD: string;
  size?: number;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon d={iconD} size={size} />
    </button>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ progressMs, durationMs }: { progressMs: number; durationMs: number }) {
  const pct = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-border">
      <div
        className="h-full rounded-full bg-accent transition-all duration-1000"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Volume slider ──────────────────────────────────────────────────────────────

function VolumeSlider({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon d={ICONS.volume} size={14} />
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer accent-accent"
        aria-label="Volume"
      />
    </div>
  );
}

// ── Search results ─────────────────────────────────────────────────────────────

function SearchDropdown({
  results,
  isSearching,
  onPlayTrack,
  onPlayPlaylist,
  onClose,
}: {
  results: { tracks: { items: SpotifyTrack[] }; playlists: { items: SpotifyPlaylist[] } } | null;
  isSearching: boolean;
  onPlayTrack: (track: SpotifyTrack) => void;
  onPlayPlaylist: (playlist: SpotifyPlaylist) => void;
  onClose: () => void;
}) {
  if (isSearching) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        Searching…
      </div>
    );
  }

  if (!results) return null;

  const tracks    = results.tracks?.items ?? [];
  const playlists = results.playlists?.items ?? [];

  if (tracks.length === 0 && playlists.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        No results found.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-card shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Results</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition">
          <Icon d={ICONS.close} size={14} />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {/* Tracks */}
        {tracks.length > 0 && (
          <div>
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Tracks
            </p>
            {tracks.map((track) => (
              <button
                key={track.id}
                onClick={() => onPlayTrack(track)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-muted"
              >
                <TrackArt images={track.album.images} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{track.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {track.artists.map((a) => a.name).join(', ')}
                  </p>
                </div>
                <span className="text-muted-foreground"><Icon d={ICONS.play} size={14} /></span>
              </button>
            ))}
          </div>
        )}

        {/* Playlists */}
        {playlists.length > 0 && (
          <div>
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Playlists
            </p>
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => onPlayPlaylist(pl)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-muted"
              >
                <TrackArt images={pl.images} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{pl.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {pl.tracks.total} tracks · {pl.owner.display_name}
                  </p>
                </div>
                <span className="text-muted-foreground"><Icon d={ICONS.play} size={14} /></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  /** compact = minimal now-playing strip for active session view */
  compact?: boolean;
}

export function SpotifyPanel({ compact = false }: Props) {
  const {
    connected, playerReady, profile, playbackState,
    searchResults, error, isSearching, volume,
    login, logout, search, clearSearch,
    play, pause, next, previous, setVolume,
    transferToPlayer, clearError,
  } = useSpotify();

  const [collapsed,   setCollapsed]   = useState(compact);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef  = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = playbackState?.item;

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { clearSearch(); return; }
    searchTimer.current = setTimeout(() => search(value), 400);
  };

  // Dismiss search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const panel = document.getElementById('spotify-panel');
      if (panel && !panel.contains(e.target as Node)) clearSearch();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [clearSearch]);

  // ── Not connected ──────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <div
        id="spotify-panel"
        className="rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#1DB954]"><SpotifyLogo size={16} /></span>
          <span className="text-xs font-semibold text-foreground">Spotify</span>
          <span className="ml-auto text-[10px] text-muted-foreground">Optional</span>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="shrink-0 text-danger hover:text-danger transition">
              <Icon d={ICONS.close} size={12} />
            </button>
          </div>
        )}

        <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
          Connect your Spotify account to play music during focus sessions.
          Requires Spotify Premium.
        </p>
        <button
          onClick={login}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1DB954] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#1ed760] active:scale-[0.98]"
        >
          <SpotifyLogo size={16} />
          Connect Spotify
        </button>
      </div>
    );
  }

  // ── Connected — compact strip (used during active session) ─────────────────

  if (compact && collapsed) {
    return (
      <div
        id="spotify-panel"
        className="rounded-2xl border border-border bg-card overflow-hidden"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-muted"
        >
          <span className="text-[#1DB954]"><SpotifyLogo size={14} /></span>
          {track ? (
            <>
              <TrackArt images={track.album.images} size={28} />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium text-foreground">{track.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {track.artists.map((a) => a.name).join(', ')}
                </p>
              </div>
            </>
          ) : (
            <span className="flex-1 text-left text-xs text-muted-foreground">
              {playerReady ? 'No track playing' : 'Spotify connected'}
            </span>
          )}
          <div className="flex items-center gap-1 text-muted-foreground">
            {playbackState && (
              <button
                aria-label={playbackState.is_playing ? 'Pause' : 'Play'}
                onClick={(e) => { e.stopPropagation(); playbackState.is_playing ? pause() : play(); }}
                className="rounded p-1 hover:text-foreground transition"
              >
                <Icon d={playbackState.is_playing ? ICONS.pause : ICONS.play} size={14} />
              </button>
            )}
            <Icon d={ICONS.chevDown} size={14} />
          </div>
        </button>

        {track && (
          <ProgressBar
            progressMs={playbackState?.progress_ms ?? 0}
            durationMs={track.duration_ms}
          />
        )}
      </div>
    );
  }

  // ── Connected — full panel ─────────────────────────────────────────────────

  return (
    <div
      id="spotify-panel"
      className="rounded-2xl border border-border bg-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-[#1DB954]"><SpotifyLogo size={15} /></span>
        <span className="text-xs font-semibold text-foreground">Spotify</span>

        {profile && (
          <span className="ml-1 truncate text-xs text-muted-foreground">{profile.display_name}</span>
        )}

        {/* Device status dot */}
        <span
          title={playerReady ? 'Browser player ready' : 'Player not ready'}
          className={`ml-auto h-1.5 w-1.5 rounded-full ${playerReady ? 'bg-accent' : 'bg-border'}`}
        />

        {compact && (
          <button
            onClick={() => setCollapsed(true)}
            className="ml-2 text-muted-foreground hover:text-foreground transition"
            aria-label="Collapse"
          >
            <Icon d={ICONS.chevUp} size={14} />
          </button>
        )}

        <button
          onClick={logout}
          className={`${compact ? '' : 'ml-2'} text-muted-foreground hover:text-foreground transition`}
          aria-label="Disconnect Spotify"
          title="Disconnect"
        >
          <Icon d={ICONS.close} size={14} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="shrink-0 text-danger hover:text-danger transition">
              <Icon d={ICONS.close} size={12} />
            </button>
          </div>
        )}

        {/* Transfer to browser player */}
        {connected && !playerReady && (
          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
            <p className="mb-2 text-xs text-muted-foreground">
              Initializing browser player…
            </p>
            <button
              onClick={transferToPlayer}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <Icon d={ICONS.transfer} size={12} />
              Transfer playback here
            </button>
          </div>
        )}

        {/* Now playing */}
        {track ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <TrackArt images={track.album.images} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{track.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {track.artists.map((a) => a.name).join(', ')}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">{track.album.name}</p>
              </div>
            </div>

            <ProgressBar
              progressMs={playbackState?.progress_ms ?? 0}
              durationMs={track.duration_ms}
            />

            {/* Playback controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <ControlBtn
                  iconD={ICONS.prev}
                  onClick={previous}
                  disabled={!playerReady}
                  label="Previous track"
                />
                <ControlBtn
                  iconD={playbackState?.is_playing ? ICONS.pause : ICONS.play}
                  onClick={() => (playbackState?.is_playing ? pause() : play())}
                  disabled={!playerReady}
                  size={20}
                  label={playbackState?.is_playing ? 'Pause' : 'Play'}
                />
                <ControlBtn
                  iconD={ICONS.next}
                  onClick={next}
                  disabled={!playerReady}
                  label="Next track"
                />
              </div>
              <VolumeSlider volume={volume} onChange={setVolume} />
            </div>
          </div>
        ) : (
          playerReady && (
            <div className="flex flex-col items-center gap-2 py-2 text-center text-muted-foreground">
              <Icon d={ICONS.music} size={24} />
              <p className="text-xs text-muted-foreground">
                Search for a track or playlist to start playing.
              </p>
            </div>
          )
        )}

        {/* Search */}
        {connected && (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-ring transition">
              <span className="text-muted-foreground"><Icon d={ICONS.search} size={14} /></span>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search tracks or playlists…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="flex-1 bg-transparent text-xs text-foreground placeholder-muted-foreground focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); clearSearch(); }}
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  <Icon d={ICONS.close} size={12} />
                </button>
              )}
            </div>

            <SearchDropdown
              results={searchResults}
              isSearching={isSearching}
              onPlayTrack={(t) => {
                play({ uris: [t.uri] });
                clearSearch();
                setSearchQuery('');
              }}
              onPlayPlaylist={(pl) => {
                play({ context_uri: pl.uri });
                clearSearch();
                setSearchQuery('');
              }}
              onClose={() => { clearSearch(); setSearchQuery(''); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
