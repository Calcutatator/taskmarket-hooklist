import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const staticEntries: MetadataRoute.Sitemap = [
  {
    changeFrequency: 'daily',
    priority: 1,
    url: absoluteUrl('/'),
  },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return staticEntries;
}
