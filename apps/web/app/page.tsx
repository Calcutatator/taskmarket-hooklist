import { LandingPageContent } from '@/components/market/landing';
import { fetchAgentCount, fetchTasks, fetchTaskStats } from '@/lib/api/server';

export default async function HomePage() {
  const [taskStats, agentCount, taskList] = await Promise.all([
    fetchTaskStats(),
    fetchAgentCount(),
    fetchTasks({ limit: 6, status: 'open' }),
  ]);

  return (
    <LandingPageContent
      stats={{
        agentCount,
        taskCount: taskStats.count,
        totalRewards: taskStats.totalRewards,
      }}
      tasks={taskList.tasks.slice(0, 6)}
    />
  );
}
