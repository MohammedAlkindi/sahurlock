export const DEFAULT_PUNISHMENT_MEDIA = '/media/sahur.mp4';

/** Settings value meaning "the video the user uploaded", stored in IndexedDB. */
export const CUSTOM_PUNISHMENT_MEDIA = 'custom';

export interface PunishmentMediaSources {
  /** Blob URL already created in this page session, if any. */
  cachedUrl: () => string | null;
  /** IndexedDB key of the uploaded video, or null when none is saved. */
  customVideoId: () => string | null;
  loadBlob: (id: string) => Promise<Blob | null>;
  createUrl: (blob: Blob) => string;
}

/**
 * Turn the punishmentMedia setting into something a <video> can play.
 * A bundled clip path passes through. "custom" becomes a blob URL for the
 * uploaded video, falling back to the default clip when it cannot be loaded.
 */
export async function resolvePunishmentMedia(
  media: string,
  sources: PunishmentMediaSources,
): Promise<{ src: string; createdUrl: string | null }> {
  if (media !== CUSTOM_PUNISHMENT_MEDIA) return { src: media, createdUrl: null };

  const cached = sources.cachedUrl();
  if (cached) return { src: cached, createdUrl: null };

  const id = sources.customVideoId();
  if (!id) return { src: DEFAULT_PUNISHMENT_MEDIA, createdUrl: null };

  try {
    const blob = await sources.loadBlob(id);
    if (!blob) return { src: DEFAULT_PUNISHMENT_MEDIA, createdUrl: null };
    const url = sources.createUrl(blob);
    return { src: url, createdUrl: url };
  } catch {
    return { src: DEFAULT_PUNISHMENT_MEDIA, createdUrl: null };
  }
}
