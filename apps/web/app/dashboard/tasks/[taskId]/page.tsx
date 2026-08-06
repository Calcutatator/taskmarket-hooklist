import type { Metadata } from 'next';
import { cache } from 'react';
import { TaskActionIntent } from '@taskmarket/shared';

import { TaskDetailPanel } from '@/components/market/tasks';
import { PrivateTaskAccessGate } from '@/components/market/private-task-access-gate';
import { fetchMarketStats, fetchTask, fetchTaskModeData, type MarketStats } from '@/lib/api/server';
import {
  buildDashboardPageMetadata,
  buildDashboardTaskMetadata,
  dashboardTaskPath,
  decodeRouteParam,
} from '@/lib/seo';

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string;
  }>;
  searchParams?: Promise<{
    focus?: string | string[];
  }>;
};

const getTask = cache(fetchTask);

// The market signal is decorative: never let it delay (or block) rendering.
// Take whichever resolves first - the stats or a short fallback to null.
async function loadMarketStats(): Promise<MarketStats | null> {
  return Promise.race([
    fetchMarketStats().catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 1_500);
    }),
  ]);
}

export async function generateMetadata({ params }: TaskDetailPageProps): Promise<Metadata> {
  const { taskId } = await params;
  const decodedTaskId = decodeRouteParam(taskId);

  try {
    const task = await getTask(decodedTaskId);
    if (task) {
      return buildDashboardTaskMetadata(task);
    }
  } catch {
    return buildDashboardPageMetadata({
      description: 'Browse this Taskmarket task and related marketplace details.',
      path: dashboardTaskPath(decodedTaskId),
      title: 'Taskmarket task',
    });
  }

  return buildDashboardPageMetadata({
    description: 'Browse open Taskmarket work across all marketplace modes.',
    path: '/dashboard/tasks',
    title: 'Task not found',
  });
}

export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const { taskId } = await params;
  const focusParam = (await searchParams)?.focus;
  const focusIntent = TaskActionIntent.safeParse(
    Array.isArray(focusParam) ? focusParam[0] : focusParam
  ).data;
  const decodedTaskId = decodeRouteParam(taskId);
  const task = await getTask(decodedTaskId);

  // Phase 3 (ADR-0031/0031): see the (public) task detail route's identical comment.
  if (!task) {
    return (
      <PrivateTaskAccessGate
        backHref="/dashboard/tasks"
        browseAgentsHref="/dashboard/agents"
        browseTasksHref="/dashboard/tasks"
        profileBasePath="/dashboard/agents"
        taskId={decodedTaskId}
      />
    );
  }

  const [modeData, marketStats] = await Promise.all([fetchTaskModeData(task), loadMarketStats()]);

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <TaskDetailPanel
        focusIntent={focusIntent}
        marketStats={marketStats}
        modeData={modeData}
        task={task}
      />
    </div>
  );
}
