import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGES, SITE_IMAGE_VERSION, SITE_NAME, pageMetadata } from '@/lib/site';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the share image', () => {
  it('gets a new address whenever the picture changes, since link previews keep the old one', () => {
    // Everything that decides the picture: the card's source, the name it draws, its two fonts, and the
    // Next.js version whose renderer draws it.
    const fingerprint = createHash('sha256')
      .update(readFileSync('src/app/opengraph-image.tsx', 'utf8').replace(/\r\n/g, '\n') + SITE_NAME)
      .update(readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf'))
      .update(readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Black.ttf'))
      .update(JSON.parse(readFileSync('node_modules/next/package.json', 'utf8')).version)
      .digest('hex')
      .slice(0, 16);
    // The version is the fingerprint, so the test passes only once the address has changed too.
    expect(SITE_IMAGE_VERSION, `the share card changed: set SITE_IMAGE_VERSION in src/lib/site.ts to '${fingerprint}'`).toBe(fingerprint);
  });

  it('is in the Open Graph data of every tool page, with its version', () => {
    for (const id of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
      expect(pageMetadata(id).openGraph?.images).toEqual([expect.objectContaining({ url: `/opengraph-image?v=${SITE_IMAGE_VERSION}` })]);
    }
  });
});

describe('the site address', () => {
  it('drops a trailing slash from NEXT_PUBLIC_SITE_URL, so built links have no double slash', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://notes.example/');
    const { SITE_URL } = await import('@/lib/site');
    expect(SITE_URL).toBe('https://notes.example');
  });
});

describe('page metadata', () => {
  it('gives each tool its own title, description and canonical path', () => {
    const meta = pageMetadata('scan');
    expect(meta).toMatchObject({ title: PAGES.scan.title, description: PAGES.scan.description, alternates: { canonical: '/scan' } });
    expect(meta.openGraph).toMatchObject({ url: '/scan', siteName: SITE_NAME, title: `${PAGES.scan.title} · ${SITE_NAME}` });
  });
});
