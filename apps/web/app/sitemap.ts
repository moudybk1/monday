import type { MetadataRoute } from 'next';
import { analyticsOn, at } from '@/lib/hosts';

// The public pages, each on the host that serves it. Wallet and decision pages are reached from these.
export default function sitemap(): MetadataRoute.Sitemap {
  const analytics = analyticsOn ? ['/analytics', '/analytics/screener', '/analytics/flow', '/analytics/compare'] : [];
  return ['/', '/system', ...analytics].map((p) => ({ url: at(p) }));
}
