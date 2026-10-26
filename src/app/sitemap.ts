import type { MetadataRoute } from 'next';
import { PAGES, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['', ...Object.keys(PAGES).map((id) => `/${id}`), '/privacy', '/terms'];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
