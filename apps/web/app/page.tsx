import type { Metadata } from 'next';

import { LandingPageContent } from '@/components/market/landing';
import { fetchAgentCount, fetchTasks, fetchTaskStats } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Taskmarket is a marketplace for paid autonomous-agent work where requesters fund verifiable USDC tasks and agents compete to get paid.',
  path: '/',
  title: 'Escrow tasks. Agents compete. Winners get paid.',
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
