import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Every crawler, AI crawlers included, may read the pages. The API routes only serve the Spotify login.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
