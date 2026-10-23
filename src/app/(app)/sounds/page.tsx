'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Volume2, VolumeX, Square, Headphones, ChevronRight } from 'lucide-react';
import { SpotifyPanel } from '@/components/spotify-panel';
import { decodeStrings, parseStored } from '@/lib/decode';
import {
  SOUNDS,
  SoundDef,
  playAmbient,
  stopAmbient,
  setAmbientVolume,
  currentAmbient,
} from '@/lib/ambient-sound';

// ── Curation ───────────────────────────────────────────────────────────────────

const FEATURED_IDS = ['brown', 'rain', 'cafe', 'campfire', 'ocean-waves', 'alpha', 'pink', 'deep-space'];
const INITIAL_PER_CATEGORY = 8;
const RECENT_KEY = 'sahurlock.recent_sounds';
const MAX_RECENT = 3;

const CATEGORY_ORDER = [
  'Noise',
  'Rain & Water',
  'Wind & Weather',
  'Nature',
  'Urban & Indoor',
  'Space',
  'Tones',
  'Binaural',
  'Textures',
];

function loadRecent(): string[] {
  return decodeStrings(parseStored(localStorage.getItem(RECENT_KEY)));
}

function saveRecent(id: string) {
  try {
    const prev = loadRecent().filter((r) => r !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)));
  } catch {}
}

// ── Sound tile ─────────────────────────────────────────────────────────────────

function SoundTile({
  sound,
  isActive,
  onToggle,
  size = 'md',
}: {
  sound: SoundDef;
  isActive: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md';
}) {
  if (size === 'sm') {
    return (
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${
          isActive
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-border bg-card text-foreground hover:border-foreground/20 hover:bg-muted/40'
        }`}
      >
        <span className="text-base leading-none shrink-0">{sound.emoji}</span>
        <span className="text-xs font-medium leading-tight truncate">{sound.label}</span>
        {isActive && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      </button>
    );
  }
  return (
    <button
      onClick={onToggle}
      className={`relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
        isActive
          ? 'border-accent/40 bg-accent/10'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-muted/40'
      }`}
    >
      <span className="text-xl leading-none">{sound.emoji}</span>
      <span className={`text-xs font-semibold leading-tight ${isActive ? 'text-accent' : 'text-foreground'}`}>
        {sound.label}
      </span>
      {sound.headphones && <Headphones size={9} className="text-warning" />}
      {isActive && <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  );
}

// ── Category accordion ─────────────────────────────────────────────────────────

function CategorySection({
  name,
  sounds,
  activeId,
  onToggle,
  defaultOpen,
}: {
  name: string;
  sounds: SoundDef[];
  activeId: string | null;
  onToggle: (id: string) => void;
  defaultOpen: boolean;
}) {
  const [open,    setOpen]    = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? sounds : sounds.slice(0, INITIAL_PER_CATEGORY);
  const hasMore  = sounds.length > INITIAL_PER_CATEGORY;
  const preview  = sounds.slice(0, 3).map((s) => s.emoji).join(' ');

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-foreground"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        <span className="flex-1 text-sm font-medium text-foreground">{name}</span>
        {!open && (
          <span className="text-[11px] text-muted-foreground tracking-wide">{preview}</span>
        )}
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {sounds.length}
        </span>
      </button>

      {open && (
        <div className="pb-3">
          <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {visible.map((s) => (
              <SoundTile key={s.id} sound={s} isActive={activeId === s.id} onToggle={() => onToggle(s.id)} />
            ))}
          </div>
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
            >
              Show {sounds.length - INITIAL_PER_CATEGORY} more in {name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SoundsPage() {
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [volume,    setVolumeState] = useState(0.25);
  const [query,     setQuery]     = useState('');
  const [recent,    setRecent]    = useState<string[]>([]);

  useEffect(() => {
    setActiveId(currentAmbient());
    setRecent(loadRecent());
  }, []);

  const toggle = (id: string) => {
    if (activeId === id) {
      stopAmbient();
      setActiveId(null);
    } else {
      playAmbient(id, volume);
      setActiveId(id);
      saveRecent(id);
      setRecent(loadRecent());
    }
  };

  const handleVolume = (v: number) => {
    setVolumeState(v);
    setAmbientVolume(v);
  };

  const stop = () => { stopAmbient(); setActiveId(null); };

  const activeSound   = SOUNDS.find((s) => s.id === activeId) ?? null;
  const featuredSounds = FEATURED_IDS.map((id) => SOUNDS.find((s) => s.id === id)).filter(Boolean) as SoundDef[];
  const recentSounds   = recent.map((id) => SOUNDS.find((s) => s.id === id)).filter(Boolean) as SoundDef[];

  // Category groups (ordered)
  const byCategory = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      name: cat,
      sounds: SOUNDS.filter((s) => s.category === cat),
    }));
  }, []);

  // Search: flat filtered list across all sounds
  const searchResults = useMemo<SoundDef[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return SOUNDS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
  }, [query]);

  const isSearching = query.trim().length > 0;

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Now playing bar ───────────────────────────────────────────────────── */}
      {activeSound && (
        <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm px-5 py-2.5 flex items-center gap-3">
          <span className="text-base leading-none">{activeSound.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-none">{activeSound.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{activeSound.category}</p>
          </div>
          {activeSound.headphones && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-warning shrink-0">
              <Headphones size={10} />headphones
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <VolumeX size={12} className="text-muted-foreground" />
            <input
              type="range" min={0} max={1} step={0.02} value={volume}
              onChange={(e) => handleVolume(Number(e.target.value))}
              className="w-20 h-1 cursor-pointer accent-accent"
            />
            <Volume2 size={12} className="text-muted-foreground" />
          </div>
          <button
            onClick={stop}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-danger/50 hover:text-danger transition"
          >
            <Square size={9} className="fill-current" />Stop
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-5xl px-5 py-6 flex-1">

        {/* ── Header + search ────────────────────────────────────────────────── */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">Sounds</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{SOUNDS.length} ambient · browser-generated</p>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-40 rounded-lg border border-border bg-background pl-7 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* ── Search results ─────────────────────────────────────────────────── */}
        {isSearching ? (
          searchResults.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <div>
              <p className="mb-3 text-xs text-muted-foreground">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</p>
              <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {searchResults.map((s) => (
                  <SoundTile key={s.id} sound={s} isActive={activeId === s.id} onToggle={() => toggle(s.id)} />
                ))}
              </div>
            </div>
          )
        ) : (
          <>
            {/* ── Recently used ──────────────────────────────────────────────── */}
            {recentSounds.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recent</p>
                <div className="flex gap-2 flex-wrap">
                  {recentSounds.map((s) => (
                    <SoundTile key={s.id} sound={s} isActive={activeId === s.id} onToggle={() => toggle(s.id)} size="sm" />
                  ))}
                </div>
              </div>
            )}

            {/* ── Featured ───────────────────────────────────────────────────── */}
            <div className="mb-6">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Featured</p>
              <div className="grid gap-1.5 grid-cols-4 sm:grid-cols-8">
                {featuredSounds.map((s) => (
                  <SoundTile key={s.id} sound={s} isActive={activeId === s.id} onToggle={() => toggle(s.id)} />
                ))}
              </div>
            </div>

            {/* ── Category library ───────────────────────────────────────────── */}
            <div className="mb-1">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Library</p>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4">
              {byCategory.map(({ name, sounds }) => (
                <CategorySection
                  key={name}
                  name={name}
                  sounds={sounds}
                  activeId={activeId}
                  onToggle={toggle}
                  defaultOpen={sounds.some((s) => s.id === activeId)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Music / Spotify ─────────────────────────────────────────────────── */}
        <div className="mt-8 border-t border-border pt-6">
          <div className="mb-4">
            <h2 className="text-sm font-bold tracking-tight">Music</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Stream via Spotify while you work</p>
          </div>
          <div className="max-w-xs">
            <SpotifyPanel />
          </div>
        </div>

      </div>
    </div>
  );
}
