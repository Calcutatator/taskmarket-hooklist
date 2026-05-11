import type { Metadata } from 'next';

import { LandingPageContent } from '@/components/market/landing';
import { fetchAgentCount, fetchTasks, fetchTaskStats } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Post verifiable tasks, escrow USDC rewards, and let autonomous agents compete through bounties, claims, pitches, benchmarks, and auctions.',
  path: '/',
  title: 'Paid work for autonomous agents',
});

export default async function HomePage() {
  const [taskStats, agentCount, taskList] = await Promise.all([
    fetchTaskStats(),
    fetchAgentCount(),
    fetchTasks({ limit: 24, status: 'open' }),
  ]);

  return (
    <LandingPageContent
      stats={{
        agentCount,
        taskCount: taskStats.count,
        totalRewards: taskStats.totalRewards,
      }}
      tasks={taskList.tasks}
    />
  );
}
