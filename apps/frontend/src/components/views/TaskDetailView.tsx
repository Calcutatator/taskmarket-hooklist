import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { TaskDetail } from '../TaskDetail';
import { ContestPanel } from '../ContestPanel';
import { InstantPanel } from '../InstantPanel';
import { ProposalPanel } from '../ProposalPanel';
import { RacePanel } from '../RacePanel';
import { AuctionPanel } from '../AuctionPanel';
import { RatingForm } from '../RatingForm';
import { PageLayout } from '../layout/PageLayout';
import { StatePanel } from '../ui/StatePanel';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';

export function TaskDetailView({ siteUrl }: { siteUrl: string }) {
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

  const fallbackHelmet = (
    <Helmet>
      <title>Task - Taskmarket</title>
      <meta property="og:title" content="Task - Taskmarket" />
      <link rel="canonical" href={`${siteUrl}/tasks/${taskId}`} />
    </Helmet>
  );

  if (isLoading) {
    return (
      <PageLayout>
        {fallbackHelmet}
        <StatePanel
          title="Loading task"
          description="Fetching task details, submissions, and next actions."
          busy
        >
          <div className="w-full space-y-4">
            <div className="h-40 rounded-lg border border-border-primary bg-background-primary animate-pulse" />
            <div className="h-64 rounded-lg border border-border-primary bg-background-primary animate-pulse" />
          </div>
        </StatePanel>
      </PageLayout>
    );
  }

  if (!task) {
    return (
      <PageLayout>
        {fallbackHelmet}
        <StatePanel
          title="Task not found"
          description="The task you're looking for doesn't exist."
          tone="error"
        />
      </PageLayout>
    );
  }

  const taskTitle = task.description.slice(0, 60);
  const taskDesc = `${task.mode} task · ${formatUSDC(task.reward)} USDC reward · Status: ${task.status}`;
  const taskShortDesc = `${task.mode} task · ${formatUSDC(task.reward)} USDC`;

  return (
    <PageLayout>
      <Helmet>
        <title>{taskTitle} - Taskmarket</title>
        <meta name="description" content={taskDesc} />
        <meta property="og:title" content={taskTitle} />
        <meta property="og:description" content={taskDesc} />
        <meta property="og:url" content={`${siteUrl}/tasks/${task.id}`} />
        <meta property="og:image" content={`${siteUrl}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={task.description.slice(0, 100)} />
        <meta property="og:locale" content="en_US" />
        <link rel="canonical" href={`${siteUrl}/tasks/${task.id}`} />
        <meta name="twitter:title" content={taskTitle} />
        <meta name="twitter:description" content={taskShortDesc} />
        <meta name="twitter:image" content={`${siteUrl}/og-image.png`} />
      </Helmet>
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
