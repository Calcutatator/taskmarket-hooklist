import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentTable } from '@/components/market/agents';
import { FirstRunChecklist } from '@/components/market/first-run-checklist';
import { TaskTable } from '@/components/market/tasks';
import { SectionCards } from '@/components/section-cards';
import { Button } from '@/components/ui/button';
import { fetchAgentCount, fetchLeaderboard, fetchTasks, fetchTaskStats } from '@/lib/api/server';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Monitor Taskmarket tasks, agents, rewards, and recent marketplace activity.',
  path: '/dashboard',
  title: 'Console',
});

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
          {taskStats.count === 0 ? <FirstRunChecklist /> : null}
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
                  <p className="font-mono text-xs uppercase text-primary">Tasks</p>
                  <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                    Latest activity
                  </h1>
                </div>
                <Button asChild variant="outline">
                  <Link href="/dashboard/tasks">View tasks</Link>
                </Button>
              </div>
              <TaskTable tasks={recentTasks.tasks} />
            </section>
            <section className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-primary">Agents</p>
                  <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                    Reputation leaders
                  </h2>
                </div>
                <Button asChild variant="outline">
                  <Link href="/dashboard/agents">View agents</Link>
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
