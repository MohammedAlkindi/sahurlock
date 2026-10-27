import type { Metadata } from 'next';

/** The production address, for canonical links, the sitemap and share cards. No trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sahurlock.vercel.app').replace(/\/+$/, '');

export const SITE_NAME = 'SahurLock';

export const SITE_DESCRIPTION =
  'A free student toolkit in your browser: focus sessions that check your attention with your webcam, tasks, notes, flashcards, a schedule, and Scan, which cleans up photos of handwritten notes. Camera frames, notes and scans stay on your device.';

export const SITE_IMAGE_ALT = `${SITE_NAME}: focus sessions, notes and study tools in your browser`;

/**
 * Part of the share image's address: a fingerprint of what app/opengraph-image.tsx draws, the fonts
 * it draws in and the Next.js version that renders it. Sites that show link previews keep the image
 * they fetched under its address, so a new picture needs a new address. site.test.ts fails, and
 * prints the new fingerprint, until this matches.
 */
export const SITE_IMAGE_VERSION = '2da1fe2289c5dc42';

/**
 * Every page's Open Graph fields start from these. A page's own openGraph replaces its
 * parent's, share image included, so the image drawn by app/opengraph-image.tsx is named here.
 */
export const SITE_OPEN_GRAPH = {
  type: 'website',
  siteName: SITE_NAME,
  images: [{ url: `/opengraph-image?v=${SITE_IMAGE_VERSION}`, width: 1200, height: 630, alt: SITE_IMAGE_ALT }],
};

export interface PageInfo {
  title: string;
  description: string;
}

/** Each route's title and description. Its layout, the sitemap and llms.txt read them. */
export const PAGES = {
  session: {
    title: 'Focus session',
    description: 'Start a focus session. Your webcam checks, on your device, that you are looking at the screen, and a full-screen reminder appears when you look away for too long.',
  },
  tasks: {
    title: 'Tasks',
    description: 'Keep a task list and pick a task to work on in a focus session.',
  },
  stats: {
    title: 'Stats',
    description: 'See your focus history: sessions, focus time, scores and streaks.',
  },
  schedule: {
    title: 'Schedule',
    description: 'Plan focus sessions for later and get a reminder when one is due.',
  },
  notes: {
    title: 'Notes',
    description: 'Write quick notes, kept in this browser.',
  },
  flashcards: {
    title: 'Flashcards',
    description: 'Make flashcards and review them with spaced repetition.',
  },
  scan: {
    title: 'Scan notes',
    description: 'Photograph or import handwritten notes and get clean, straight pages to save as one PDF. Everything runs on your device.',
  },
  timer: {
    title: 'Timer',
    description: 'A stopwatch with laps and a countdown timer.',
  },
  sounds: {
    title: 'Sounds',
    description: 'Play ambient sounds, or your Spotify, while you study.',
  },
  settings: {
    title: 'Settings',
    description: 'Change how focus sessions work, and export or clear your data.',
  },
} as const satisfies Record<string, PageInfo>;

export type PageId = keyof typeof PAGES;

/** Metadata for the page at `path`: its own title and description, and a canonical link to itself. */
export function metadataFor(path: string, { title, description }: PageInfo): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...SITE_OPEN_GRAPH, title: `${title} · ${SITE_NAME}`, description, url: path },
  };
}

/** Metadata for one of the tools, from PAGES. */
export const pageMetadata = (id: PageId) => metadataFor(`/${id}`, PAGES[id]);
