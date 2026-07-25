import type { AgentStats, TaskDetailResponse } from '@taskmarket/shared';
import type { Metadata } from 'next';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentMetadata,
  buildDashboardAgentMetadata,
  buildDashboardPageMetadata,
  buildDashboardTaskMetadata,
  buildPageMetadata,
  buildTaskMetadata,
  dashboardAgentPath,
  dashboardTaskPath,
  getSiteUrl,
  publicAgentPath,
  publicTaskPath,
  taskSeoTitle,
  truncateText,
} from '@/lib/seo';
import { buildStaticPageMetadata, staticOgConfigs } from '@/lib/static-og';

const baseTask: TaskDetailResponse = {
  auctionBidCount: null,
  auctionFloorPrice: null,
  auctionPriceReachesFloorAt: null,
  auctionPriceReachesMaxAt: null,
  auctionStartPrice: null,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  currentAuctionPrice: null,
  currentLowestBid: null,
  description: 'Build a typed parser for agent capability manifests.\nInclude fixtures.',
  escrowTxHash: '0xescrow',
  expiryTime: '2026-01-08T00:00:00.000Z',
  id: 'task-123',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  pendingActions: [],
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: '0x0000000000000000000000000000000000000001',
  requesterPubkey: '0x0000000000000000000000000000000000000001',
  reward: '850000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  submissionWindowOpen: true,
  phase: 'active',
  tags: ['typescript', 'agents'],
  taskVisibility: 'public',
  submissionVisibility: 'public',
};

const baseAgent: AgentStats = {
  address: '0x0000000000000000000000000000000000000002',
  agentId: '42',
  averageRating: 4.75,
  completedTasks: 12,
  ratedTasks: 8,
  recentRatings: [],
  skills: ['typescript', 'analysis'],
  totalEarnings: '1250000000',
  totalStars: 38,
};

describe('seo helpers', () => {
  it('derives the site URL from deployment environment values when the public override is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', 'preview.taskmarket.dev');

    expect(getSiteUrl()).toBe('https://preview.taskmarket.dev');

    vi.unstubAllEnvs();
  });

  it('normalizes the canonical site URL from the public environment value', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://market.example/');

    expect(getSiteUrl()).toBe('https://market.example');
    expect(publicTaskPath('task/with spaces')).toBe('/tasks/task%2Fwith%20spaces');
    expect(publicAgentPath('agent name')).toBe('/agents/agent%20name');
    expect(dashboardTaskPath('task/with spaces')).toBe('/dashboard/tasks/task%2Fwith%20spaces');
    expect(dashboardAgentPath('agent name')).toBe('/dashboard/agents/agent%20name');

    vi.unstubAllEnvs();
  });

  it('derives the site URL from the Railway public domain', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('VERCEL_BRANCH_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('URL', '');
    vi.stubEnv('DEPLOY_PRIME_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'taskmarketfrontend-production.up.railway.app');

    expect(getSiteUrl()).toBe('https://taskmarketfrontend-production.up.railway.app');

    vi.unstubAllEnvs();
  });

  it('truncates long task titles without splitting the title fallback behavior', () => {
    expect(truncateText('abcdefghij', 8)).toBe('abcde...');
    expect(taskSeoTitle({ ...baseTask, description: '\n' })).toBe('Task task-123');
  });

  it('builds task metadata for a bounty task with tags and reward context', () => {
    const metadata = buildTaskMetadata(baseTask);

    expect(metadata.title).toBe('Build a typed parser for agent capability manifests.');
    expect(metadata.description).toBe(
      'Bounty task. Reward: 850 USDC. Status: open. Tags: typescript, agents.'
    );
    expect(metadata.alternates).toEqual({ canonical: '/tasks/task-123' });
    expect(metadata.openGraph?.url).toBe('/tasks/task-123');
    expect(Object.hasOwn(metadata.openGraph ?? {}, 'images')).toBe(false);
    expect(Object.hasOwn(metadata.twitter ?? {}, 'images')).toBe(false);
    expect((metadata.twitter as { card?: string })?.card).toBe('summary_large_image');
  });

  it('builds noindex dashboard page metadata with OG tags', () => {
    const metadata = buildDashboardPageMetadata({
      description: 'Browse open Taskmarket work across marketplace modes.',
      path: '/dashboard/tasks',
      title: 'Open tasks',
    });

    expect(metadata.alternates).toEqual({ canonical: '/dashboard/tasks' });
    expect(metadata.robots).toEqual({ follow: true, index: false });
    expect(metadata.openGraph?.url).toBe('/dashboard/tasks');
    expect(metadata.openGraph?.images).toEqual([
      {
        alt: 'Open tasks',
        height: 630,
        url: '/opengraph-image',
        width: 1200,
      },
    ]);
    expect((metadata.twitter as { card?: string })?.card).toBe('summary_large_image');
  });

  it('uses an explicit share title only for social metadata', () => {
    const metadata = buildPageMetadata({
      description: 'A page description.',
      ogTitle: 'The share title',
      path: '/example',
      title: 'The browser title',
    });

    expect(metadata.title).toBe('The browser title');
    expect(metadata.openGraph?.title).toBe('The share title');
    expect((metadata.twitter as { title?: string })?.title).toBe('The share title');
  });

  it('builds route-specific metadata for static public OG pages', () => {
    const cases = Object.entries(staticOgConfigs);

    for (const [, config] of cases) {
      const metadata = buildStaticPageMetadata(
        config.path.slice(1) as Parameters<typeof buildStaticPageMetadata>[0]
      );

      expect(metadata.alternates).toEqual({ canonical: config.path });
      expect(Object.hasOwn(metadata.openGraph ?? {}, 'images')).toBe(false);
      expect(Object.hasOwn(metadata.twitter ?? {}, 'images')).toBe(false);
    }
  });

  // Regression guard for the whole class of bug this replaced, and it has to check for an
  // absent key rather than an undefined value. Next injects the colocated opengraph-image.tsx
  // only when the page's own metadata does not `hasOwnProperty('images')`, so `images:
  // undefined` reads as "this page set its own images" and emits no card at all - the same
  // silent failure as the hardcoded `${path}/opengraph-image` it replaced, which pointed at a
  // 404 while the meta tag still looked correct.
  it('never hardcodes an opengraph-image path', () => {
    expect(Object.hasOwn(buildStaticPageMetadata('tasks').openGraph ?? {}, 'images')).toBe(false);

    const builders: Array<Metadata> = [
      buildTaskMetadata(baseTask),
      buildDashboardTaskMetadata(baseTask),
      buildAgentMetadata(baseAgent, '42'),
      buildDashboardAgentMetadata(baseAgent, '42'),
      ...Object.keys(staticOgConfigs).map((key) =>
        buildStaticPageMetadata(key as Parameters<typeof buildStaticPageMetadata>[0])
      ),
    ];

    for (const metadata of builders) {
      expect(Object.hasOwn(metadata.openGraph ?? {}, 'images')).toBe(false);
      expect(Object.hasOwn(metadata.twitter ?? {}, 'images')).toBe(false);
    }
  });

  it('still emits the shared default card for routes without their own image', () => {
    const metadata = buildPageMetadata({
      description: 'A page description.',
      path: '/example',
      title: 'The browser title',
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        alt: 'The browser title',
        height: 630,
        url: '/opengraph-image',
        width: 1200,
      },
    ]);
  });

  it('builds noindex dashboard task metadata that defers to its own OG image route', () => {
    const metadata = buildDashboardTaskMetadata(baseTask);

    expect(metadata.alternates).toEqual({ canonical: '/dashboard/tasks/task-123' });
    expect(metadata.robots).toEqual({ follow: true, index: false });
    expect(metadata.openGraph?.url).toBe('/dashboard/tasks/task-123');
    expect(Object.hasOwn(metadata.openGraph ?? {}, 'images')).toBe(false);
  });

  it('builds task metadata for auction tasks without a tags suffix when tags are empty', () => {
    const metadata = buildTaskMetadata({
      ...baseTask,
      auctionType: 'reverse_english',
      mode: 'auction',
      tags: [],
    });

    expect(metadata.description).toBe(
      'Reverse english auction task. Reward: 850 USDC. Status: open.'
    );
  });

  it('builds agent metadata for agent id and raw address routes', () => {
    const agentMetadata = buildAgentMetadata(baseAgent, '42');
    const addressMetadata = buildAgentMetadata({ ...baseAgent, agentId: null, skills: [] });
    const dashboardAgentMetadata = buildDashboardAgentMetadata(baseAgent, '42');

    expect(agentMetadata.title).toBe('PhotonGlowPhantom');
    expect(agentMetadata.description).toBe(
      '12 completed tasks. Rating: 4.8. Total earned: 1,250 USDC. Skills: typescript, analysis.'
    );
    expect(agentMetadata.alternates).toEqual({ canonical: '/agents/42' });
    expect(addressMetadata.title).toBe('0x0000...0002');
    expect(addressMetadata.description).toBe(
      '12 completed tasks. Rating: 4.8. Total earned: 1,250 USDC.'
    );
    expect(dashboardAgentMetadata.alternates).toEqual({ canonical: '/dashboard/agents/42' });
    expect(dashboardAgentMetadata.robots).toEqual({ follow: true, index: false });
    expect(dashboardAgentMetadata.openGraph?.url).toBe('/dashboard/agents/42');
    expect(Object.hasOwn(dashboardAgentMetadata.openGraph ?? {}, 'images')).toBe(false);
  });
});
