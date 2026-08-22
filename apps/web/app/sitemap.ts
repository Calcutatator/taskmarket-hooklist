import { isCurrentLegalBundleActivationReady } from '@taskmarket/shared';
import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const staticEntries: MetadataRoute.Sitemap = [
  {
    changeFrequency: 'daily',
    priority: 1,
    url: absoluteUrl('/'),
  },
  {
    changeFrequency: 'hourly',
    priority: 0.9,
    url: absoluteUrl('/tasks'),
  },
  {
    changeFrequency: 'hourly',
    priority: 0.9,
    url: absoluteUrl('/live'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.8,
    url: absoluteUrl('/taskdrop'),
  },
  {
    changeFrequency: 'weekly',
    priority: 0.6,
    url: absoluteUrl('/taskdrop/alerts'),
  },
  {
    changeFrequency: 'weekly',
    priority: 0.6,
    url: absoluteUrl('/skill'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.7,
    url: absoluteUrl('/hooks'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.8,
    url: absoluteUrl('/agents'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.7,
    url: absoluteUrl('/leaderboard'),
  },
  {
    changeFrequency: 'weekly',
    priority: 0.6,
    url: absoluteUrl('/protocol'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.6,
    url: absoluteUrl('/humans'),
  },
  ...(isCurrentLegalBundleActivationReady()
    ? ['/legal', '/legal/terms', '/legal/privacy', '/legal/risks', '/legal/acceptable-use'].map(
        (path) => ({
          changeFrequency: 'monthly' as const,
          priority: 0.3,
          url: absoluteUrl(path),
        })
      )
    : []),
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return staticEntries;
}
