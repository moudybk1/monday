import type { MetadataRoute } from 'next';
import { at } from '@/lib/hosts';

// The public pages, each on the host that serves it. Wallet and decision pages are reached from these.
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/system', '/analytics', '/analytics/screener', '/analytics/flow', '/analytics/compare'].map((p) => ({ url: at(p) }));
}
