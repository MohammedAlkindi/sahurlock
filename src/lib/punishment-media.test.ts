import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_PUNISHMENT_MEDIA,
  DEFAULT_PUNISHMENT_MEDIA,
  resolvePunishmentMedia,
  type PunishmentMediaSources,
} from '@/lib/punishment-media';

const blob = new Blob(['video'], { type: 'video/mp4' });

const sources = (overrides: Partial<PunishmentMediaSources> = {}): PunishmentMediaSources => ({
  cachedUrl: () => null,
  customVideoId: () => 'custom_1',
  loadBlob: async () => blob,
  createUrl: () => 'blob:fresh',
  ...overrides,
});

describe('resolvePunishmentMedia', () => {
  it('passes a bundled clip path straight through', async () => {
    const loadBlob = vi.fn();
    const result = await resolvePunishmentMedia('/media/other.mp4', sources({ loadBlob }));
    expect(result).toEqual({ src: '/media/other.mp4', createdUrl: null });
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it('reuses a blob URL already created in this page session', async () => {
    const loadBlob = vi.fn();
    const result = await resolvePunishmentMedia(
      CUSTOM_PUNISHMENT_MEDIA,
      sources({ cachedUrl: () => 'blob:cached', loadBlob }),
    );
    expect(result).toEqual({ src: 'blob:cached', createdUrl: null });
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it('loads the uploaded video and reports the URL it created', async () => {
    const result = await resolvePunishmentMedia(CUSTOM_PUNISHMENT_MEDIA, sources());
    expect(result).toEqual({ src: 'blob:fresh', createdUrl: 'blob:fresh' });
  });

  it('falls back to the default clip when no video was uploaded', async () => {
    const result = await resolvePunishmentMedia(
      CUSTOM_PUNISHMENT_MEDIA,
      sources({ customVideoId: () => null }),
    );
    expect(result.src).toBe(DEFAULT_PUNISHMENT_MEDIA);
  });

  it('falls back when the stored video is missing or unreadable', async () => {
    const missing = await resolvePunishmentMedia(
      CUSTOM_PUNISHMENT_MEDIA,
      sources({ loadBlob: async () => null }),
    );
    const failing = await resolvePunishmentMedia(
      CUSTOM_PUNISHMENT_MEDIA,
      sources({ loadBlob: async () => { throw new Error('IndexedDB unavailable'); } }),
    );
    expect(missing.src).toBe(DEFAULT_PUNISHMENT_MEDIA);
    expect(failing.src).toBe(DEFAULT_PUNISHMENT_MEDIA);
  });
});
