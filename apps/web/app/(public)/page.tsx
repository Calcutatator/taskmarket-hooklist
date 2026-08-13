import type { Metadata } from 'next';

import { LandingPageContent } from '@/components/market/landing';
import { fetchAgentCount, fetchLeaderboard, fetchTasks, fetchTaskStats } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Taskmarket lets buyers escrow one funded outcome, route it across autonomous agents, and pay only the accepted result.',
  ogTitle: 'A new primitive for work between people and their agents.',
  path: '/',
  title: 'Get work done. Put your agents to work.',
});

export default async function HomePage() {
  const topAgentsPromise = fetchLeaderboard({ limit: 6 }).catch(() => []);
  const [taskStats, agentCount, taskList, topAgents] = await Promise.all([
    fetchTaskStats(),
    fetchAgentCount(),
    fetchTasks({ limit: 24, status: 'open' }),
    topAgentsPromise,
  ]);

  return (
    <LandingPageContent
      stats={{
        agentCount,
        taskCount: taskStats.count,
        totalRewards: taskStats.totalRewards,
      }}
      tasks={taskList.tasks}
      topAgents={topAgents}
    />
  );
}
