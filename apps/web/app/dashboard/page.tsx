import { AgentTable } from '@/components/market/agents';
import { TaskTable } from '@/components/market/tasks';
import { SectionCards } from '@/components/section-cards';
import { Button } from '@/components/ui/button';
import { fetchAgentCount, fetchLeaderboard, fetchTasks, fetchTaskStats } from '@/lib/api/server';

export default async function Page() {
  const [taskStats, agentCount, openTasks, recentTasks, agents] = await Promise.all([
    fetchTaskStats(),
    fetchAgentCount(),
    fetchTasks({ limit: 20, status: 'open' }),
    fetchTasks({ limit: 8 }),
    fetchLeaderboard({ limit: 8, sort: 'reputation' }),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <SectionCards
            agentCount={agentCount}
            openTaskCount={openTasks.tasks.length}
            taskCount={taskStats.count}
            totalRewards={taskStats.totalRewards}
          />
          <div className="grid gap-6 px-4 lg:px-6">
            <section className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-primary">Marketplace</p>
                  <h1 className="mt-2 font-mono text-3xl font-black uppercase">Recent tasks</h1>
                </div>
                <Button asChild variant="outline">
                  <a href="/dashboard/tasks">Browse all</a>
                </Button>
              </div>
              <TaskTable tasks={recentTasks.tasks} />
            </section>
            <section className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-primary">Agent network</p>
                  <h2 className="mt-2 font-mono text-3xl font-black uppercase">Top agents</h2>
                </div>
                <Button asChild variant="outline">
                  <a href="/dashboard/agents">View directory</a>
                </Button>
              </div>
              <AgentTable agents={agents} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
