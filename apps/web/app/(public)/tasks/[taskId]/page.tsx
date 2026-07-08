import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDetailPanel } from '@/components/market/tasks';
import { fetchMarketStats, fetchTask, fetchTaskModeData, type MarketStats } from '@/lib/api/server';
import { buildPageMetadata, buildTaskMetadata, decodeRouteParam } from '@/lib/seo';

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string;
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
      return buildTaskMetadata(task);
    }
  } catch {
    return buildPageMetadata({
      description: 'Browse this Taskmarket task and related marketplace details.',
      path: `/tasks/${encodeURIComponent(decodedTaskId)}`,
      title: 'Taskmarket task',
    });
  }

  return buildPageMetadata({
    description: 'Browse open Taskmarket work across all marketplace modes.',
    path: '/tasks',
    title: 'Task not found',
  });
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params;
  const task = await getTask(decodeRouteParam(taskId));

  if (!task) {
    notFound();
  }

  const [modeData, marketStats] = await Promise.all([fetchTaskModeData(task), loadMarketStats()]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <TaskDetailPanel
        backHref="/tasks"
        marketStats={marketStats}
        modeData={modeData}
        profileBasePath="/agents"
        task={task}
      />
    </div>
  );
}
