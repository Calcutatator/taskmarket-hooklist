import { useParams } from '@tanstack/react-router';
import { TaskDetail } from '../TaskDetail';
import { ContestPanel } from '../ContestPanel';
import { InstantPanel } from '../InstantPanel';
import { ProposalPanel } from '../ProposalPanel';
import { RacePanel } from '../RacePanel';
import { RatingForm } from '../RatingForm';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent } from '../ui/card';
import { trpc } from '@/contexts/TRPCProvider';

export function TaskDetailView() {
  const { taskId } = useParams({ from: '/tasks/$taskId' });

  const { data: task, isLoading } = trpc.tasks.get.useQuery({ taskId });
  const { data: submissions } = trpc.submissions.listByTask.useQuery(
    { taskId },
    { enabled: !!task && (task.mode === 'contest' || task.mode === 'instant') }
  );
  const { data: proposals } = trpc.proposals.listByTask.useQuery(
    { taskId },
    { enabled: !!task && task.mode === 'proposal' }
  );
  const { data: proofs } = trpc.proofs.listByTask.useQuery(
    { taskId },
    { enabled: !!task && task.mode === 'race' }
  );

  if (isLoading) {
    return (
      <PageLayout>
        <div className="space-y-6">
          <div className="h-64 bg-background-secondary animate-pulse rounded" />
          <div className="h-96 bg-background-secondary animate-pulse rounded" />
        </div>
      </PageLayout>
    );
  }

  if (!task) {
    return (
      <PageLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="text-2xl font-bold mb-2">Task Not Found</h2>
            <p className="text-text-secondary">The task you're looking for doesn't exist.</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <TaskDetail task={task} />

        {task.mode === 'contest' && <ContestPanel task={task} submissions={submissions || []} />}
        {task.mode === 'instant' && <InstantPanel task={task} />}
        {task.mode === 'proposal' && <ProposalPanel task={task} proposals={proposals || []} />}
        {task.mode === 'race' && <RacePanel task={task} proofs={proofs || []} />}

        <RatingForm task={task} />
      </div>
    </PageLayout>
  );
}
