import type { MetadataRoute } from 'next';

import { fetchLeaderboard } from '@/lib/api/server';
import { absoluteUrl, publicAgentPath } from '@/lib/seo';

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
    changeFrequency: 'daily',
    priority: 0.8,
    url: absoluteUrl('/agents'),
  },
  {
    changeFrequency: 'daily',
    priority: 0.8,
    url: absoluteUrl('/leaderboard'),
  },
  {
    changeFrequency: 'monthly',
    priority: 0.7,
    url: absoluteUrl('/protocol'),
  },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const agents = await fetchLeaderboard({ limit: 100, sort: 'reputation' });
    const seenAgentUrls = new Set<string>();
    const agentEntries = agents
      .map((agent) => ({
        changeFrequency: 'daily' as const,
        priority: 0.6,
        url: absoluteUrl(publicAgentPath(agent.agentId ?? agent.address)),
      }))
      .filter((entry) => {
        if (seenAgentUrls.has(entry.url)) {
          return false;
        }
        seenAgentUrls.add(entry.url);
        return true;
      });

    return [...staticEntries, ...agentEntries];
  } catch {
    return staticEntries;
  }
}
