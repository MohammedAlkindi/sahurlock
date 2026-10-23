import { describe, expect, it } from 'vitest';
import { appStorageKeys, clearAppStorage, collectExport } from '@/lib/data-management';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

const seeded = () => {
  const s = new MemoryStorage();
  s.setItem('sahurlock.settings', JSON.stringify({ durationMinutes: 50 }));
  s.setItem('sahurlock.notes', JSON.stringify([{ id: 'n1', body: 'limits' }]));
  s.setItem('sahurlock.flashcards', JSON.stringify([{ id: 'c1' }]));
  s.setItem('sahurlock.spotify.refresh_token', 'secret-token');
  s.setItem('sahurlock.sidebar.collapsed', 'true');
  s.setItem('sahurlock-theme', 'dark');
  s.setItem('other-app', 'keep me');
  return s;
};

describe('appStorageKeys', () => {
  it('finds every key the app owns and nothing else', () => {
    expect(appStorageKeys(seeded()).sort()).toEqual([
      'sahurlock-theme',
      'sahurlock.flashcards',
      'sahurlock.notes',
      'sahurlock.settings',
      'sahurlock.sidebar.collapsed',
      'sahurlock.spotify.refresh_token',
    ]);
  });
});

describe('clearAppStorage', () => {
  it('removes the app keys, including Spotify tokens, and leaves other sites alone', () => {
    const s = seeded();
    expect(clearAppStorage(s)).toBe(6);
    expect(s.length).toBe(1);
    expect(s.getItem('other-app')).toBe('keep me');
  });
});

describe('collectExport', () => {
  it('includes notes and flashcards alongside settings', () => {
    const data = collectExport(seeded(), new Date('2026-10-23T00:00:00Z'));
    expect(data).toMatchObject({
      exportedAt: '2026-10-23T00:00:00.000Z',
      settings: { durationMinutes: 50 },
      notes: [{ id: 'n1', body: 'limits' }],
      flashcards: [{ id: 'c1' }],
    });
  });

  it('never exports Spotify tokens or UI state', () => {
    const json = JSON.stringify(collectExport(seeded(), new Date()));
    expect(json).not.toContain('secret-token');
    expect(json).not.toContain('collapsed');
  });

  it('keeps an unparseable value as raw text instead of dropping it', () => {
    const s = new MemoryStorage();
    s.setItem('sahurlock.goals', '{broken');
    expect(collectExport(s, new Date()).goals).toBe('{broken');
  });
});
