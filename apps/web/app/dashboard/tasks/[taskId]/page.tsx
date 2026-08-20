import type { Metadata } from 'next';
import { cache } from 'react';
import { TaskActionIntent } from '@taskmarket/shared';

import { CallerScopedTaskDetail } from '@/components/market/caller-scoped-task-detail';
import { PrivateTaskAccessGate } from '@/components/market/private-task-access-gate';
import {
  fetchMarketStats,
  fetchTask,
  fetchTaskEvaluationIdentities,
  fetchTaskModeData,
  fetchTaskSubmissions,
  type MarketStats,
} from '@/lib/api/server';
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
    artifact?: string | string[];
    panel?: string | string[];
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
  const [{ taskId }, query] = await Promise.all([params, searchParams]);
  const focusParam = query?.focus;
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

  const needsSeparateSubmissionRead = task.mode !== 'bounty' && task.mode !== 'claim';
  const [modeData, marketStats, evaluationIdentities, separateSubmissions] = await Promise.all([
    fetchTaskModeData(task),
    loadMarketStats(),
    fetchTaskEvaluationIdentities(task),
    needsSeparateSubmissionRead
      ? fetchTaskSubmissions(task.id, { includePreviewUrls: 'none' }).catch(() => [])
      : Promise.resolve(null),
  ]);
  const htmlSubmissions = separateSubmissions ?? modeData.submissions ?? [];
  const initialArtifactId = Array.isArray(query?.artifact) ? query.artifact[0] : query?.artifact;
  // `?artifact=` is read by two different features: a shared link to a published HTML
  // result, and the submission gallery's current selection. They are told apart by
  // `?panel=` -- an overlay names itself there (ADR-0096), so an artifact id arriving
  // alongside an open panel belongs to that panel, not to the published-result auto-open.
  const initialPanel = Array.isArray(query?.panel) ? query.panel[0] : query?.panel;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <CallerScopedTaskDetail
        evaluationIdentities={evaluationIdentities}
        focusIntent={focusIntent}
        htmlSubmissions={htmlSubmissions}
        initialArtifactId={initialArtifactId}
        initialPanel={initialPanel}
        marketStats={marketStats}
        modeData={modeData}
        task={task}
      />
    </div>
  );
}
