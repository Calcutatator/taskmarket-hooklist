import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { TaskDetail } from '../TaskDetail';
import { ContestPanel } from '../ContestPanel';
import { InstantPanel } from '../InstantPanel';
import { ProposalPanel } from '../ProposalPanel';
import { RacePanel } from '../RacePanel';
import { AuctionPanel } from '../AuctionPanel';
import { RatingForm } from '../RatingForm';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent } from '../ui/card';
import { trpc } from '@/contexts/TRPCProvider';

export function TaskDetailView() {
  const { taskId } = useParams({ from: '/tasks/$taskId' });

  const { data: task, isLoading } = trpc.tasks.get.useQuery({ taskId });
  const { data: submissions } = trpc.submissions.listByTask.useQuery(
    { taskId },
    { enabled: !!task && (task.mode === 'bounty' || task.mode === 'claim') }
  );
  const { data: pitches } = trpc.pitches.listByTask.useQuery(
    { taskId },
    { enabled: !!task && task.mode === 'pitch' }
  );
  const { data: proofs } = trpc.proofs.listByTask.useQuery(
    { taskId },
    { enabled: !!task && task.mode === 'benchmark' }
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
            <h2 className="font-heading text-2xl font-bold mb-2">Task Not Found</h2>
            <p className="text-text-secondary">The task you're looking for doesn't exist.</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ChevronLeft size={14} />
          Tasks
        </Link>

        <TaskDetail task={task} />

        {task.mode === 'bounty' && <ContestPanel task={task} submissions={submissions || []} />}
        {task.mode === 'claim' && <InstantPanel task={task} />}
        {task.mode === 'pitch' && <ProposalPanel task={task} proposals={pitches || []} />}
        {task.mode === 'benchmark' && <RacePanel task={task} proofs={proofs || []} />}
        {task.mode === 'auction' && <AuctionPanel task={task} />}

        <RatingForm task={task} />
      </div>
    </PageLayout>
  );
}
