import type { MetadataRoute } from 'next';
import { at } from '@/lib/hosts';

// The signed-in app and the API are not for search engines; the site and the public analytics are.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: ['/app', '/analytics/monday', '/api/'] }, sitemap: at('/sitemap.xml') };
}
