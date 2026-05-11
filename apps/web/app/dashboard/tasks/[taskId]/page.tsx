import { notFound } from 'next/navigation';

import { TaskDetailPanel } from '@/components/market/tasks';
import {
  fetchTask,
  fetchTaskBids,
  fetchTaskClaim,
  fetchTaskPitches,
  fetchTaskProofs,
  fetchTaskSubmissions,
} from '@/lib/api/server';

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params;
  const task = await fetchTask(taskId);

  if (!task) {
    notFound();
  }

  const [submissions, pitches, proofs, bids, claim] = await Promise.all([
    task.mode === 'bounty' || task.mode === 'claim' ? fetchTaskSubmissions(task.id) : [],
    task.mode === 'pitch' ? fetchTaskPitches(task.id) : [],
    task.mode === 'benchmark' ? fetchTaskProofs(task.id) : [],
    task.mode === 'auction' ? fetchTaskBids(task.id) : [],
    task.mode === 'claim' ? fetchTaskClaim(task.id) : null,
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <TaskDetailPanel modeData={{ bids, claim, pitches, proofs, submissions }} task={task} />
    </div>
  );
}
