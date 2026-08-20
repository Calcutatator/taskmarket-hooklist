import type { Metadata } from 'next';
import { cache } from 'react';

import { TaskDetailPanel } from '@/components/market/task-detail-panel-client';
import { PrivateTaskAccessGate } from '@/components/market/private-task-access-gate';
import {
  fetchMarketStats,
  fetchTask,
  fetchTaskEvaluationIdentities,
  fetchTaskModeData,
  fetchTaskSubmissions,
  type MarketStats,
} from '@/lib/api/server';
import { buildPageMetadata, buildTaskMetadata, decodeRouteParam } from '@/lib/seo';

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string;
  }>;
  searchParams: Promise<{
    artifact?: string | string[];
    panel?: string | string[];
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

export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const [{ taskId }, query] = await Promise.all([params, searchParams]);
  const decodedTaskId = decodeRouteParam(taskId);
  const task = await getTask(decodedTaskId);

  // Phase 3 (ADR-0031/0031): a private task the anonymous SSR fetch can't view returns
  // null here, identical to a genuinely missing task -- render the client-side access
  // gate (wallet signature or password) rather than a hard 404, so an entitled caller
  // (owner wallet, invited wallet, or a valid unlock) can still reach it.
  if (!task) {
    return (
      <PrivateTaskAccessGate
        backHref="/tasks"
        browseAgentsHref="/agents"
        browseTasksHref="/tasks"
        profileBasePath="/agents"
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
  const initialArtifactId = Array.isArray(query.artifact) ? query.artifact[0] : query.artifact;
  // `?artifact=` is read by two different features: a shared link to a published HTML
  // result, and the submission gallery's current selection. They are told apart by
  // `?panel=` -- an overlay names itself there (ADR-0096), so an artifact id arriving
  // alongside an open panel belongs to that panel, not to the published-result auto-open.
  const initialPanel = Array.isArray(query.panel) ? query.panel[0] : query?.panel;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <TaskDetailPanel
        backHref="/tasks"
        evaluationIdentities={evaluationIdentities}
        htmlSubmissions={htmlSubmissions}
        initialArtifactId={initialArtifactId}
        initialPanel={initialPanel}
        marketStats={marketStats}
        modeData={modeData}
        profileBasePath="/agents"
        task={task}
      />
    </div>
  );
}
