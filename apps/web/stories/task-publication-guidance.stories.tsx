import type { TaskDetailResponse } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MotionConfig } from 'motion/react';
import { expect, userEvent, within } from 'storybook/test';

import { TaskDetailLoading } from '@/components/dashboard-loading';
import { LiveStatusBanner } from '@/components/market/tasks/live-status-banner';
import { PublishedCelebration } from '@/components/market/tasks/published-celebration';

import { addresses, submissionFixture, taskDetailFixture } from './fixtures';

function PublicationGuidanceCatalog() {
  return <div>Task publication and requester next-step guidance</div>;
}

const meta = {
  component: PublicationGuidanceCatalog,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  title: 'Product/Task publication guidance',
} satisfies Meta<typeof PublicationGuidanceCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const openTask = taskDetailFixture({
  expiryTime: '2099-08-09T01:00:00.000Z',
  requester: addresses.requester,
  requesterPubkey: addresses.requester,
});

function OwnerStatus({
  modeData,
  task,
}: {
  modeData?: Parameters<typeof LiveStatusBanner>[0]['modeData'];
  task: TaskDetailResponse;
}) {
  return (
    <LiveStatusBanner
      marketStats={{ activeWorkers7d: 84, openTasks: 18, registeredWorkers: 512 }}
      modeData={modeData}
      task={task}
      viewerAddress={addresses.requester}
    />
  );
}

export const Loading: Story = {
  render: () => <TaskDetailLoading />,
};

export const NoActionAcrossModes: Story = {
  render: () => (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 sm:p-8">
      <OwnerStatus modeData={{ submissions: [] }} task={{ ...openTask, mode: 'bounty' }} />
      <OwnerStatus modeData={{ proofs: [] }} task={{ ...openTask, mode: 'benchmark' }} />
      <OwnerStatus
        modeData={{ claim: null }}
        task={{ ...openTask, mode: 'claim', submissionWindowOpen: false }}
      />
      <OwnerStatus
        modeData={{ pitches: [] }}
        task={{ ...openTask, mode: 'pitch', pitchDeadline: openTask.expiryTime }}
      />
      <OwnerStatus
        modeData={{ bids: [] }}
        task={{
          ...openTask,
          auctionType: 'english',
          bidDeadline: openTask.expiryTime,
          mode: 'auction',
          submissionWindowOpen: false,
        }}
      />
    </div>
  ),
};

export const SubmissionsReady: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <OwnerStatus
        modeData={{
          submissions: [
            submissionFixture(),
            submissionFixture({
              id: 'submission-2',
              workerAddress: addresses.workerB,
              workerAgentId: '84',
            }),
          ],
        }}
        task={{ ...openTask, mode: 'bounty', submissionCount: 2 }}
      />
    </div>
  ),
};

export const WaitingForAssignedWorker: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <OwnerStatus
        modeData={{ submissions: [] }}
        task={{
          ...openTask,
          claimedBy: addresses.worker,
          mode: 'claim',
          status: 'claimed',
          submissionWindowOpen: true,
        }}
      />
    </div>
  ),
};

export const LongTaskTitle: Story = {
  render: () => (
    <div className="mx-auto grid max-w-4xl gap-5 p-4 sm:p-8">
      <h1 className="break-words font-display text-2xl font-semibold leading-tight tracking-tight text-foreground">
        Produce an evidence-based review of Taskmarket onboarding across every lifecycle state and
        document clear recommendations for requesters, workers, evaluators, and dispute resolvers
      </h1>
      <OwnerStatus modeData={{ submissions: [] }} task={{ ...openTask, mode: 'bounty' }} />
    </div>
  ),
};

export const MobileDark: Story = {
  globals: { theme: 'dark' },
  parameters: { viewport: { defaultViewport: 'mobile' } },
  render: () => (
    <div className="p-3">
      <OwnerStatus modeData={{ submissions: [] }} task={{ ...openTask, mode: 'bounty' }} />
    </div>
  ),
};

export const PublishedReducedMotion: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/tasks/task-1',
        query: { published: '1' },
      },
    },
  },
  render: () => (
    <MotionConfig reducedMotion="always">
      <div className="min-h-80 p-4 sm:p-8">
        <PublishedCelebration task={openTask} />
        <div id="task-activity" />
      </div>
    </MotionConfig>
  ),
};

export const PublishedDismissal: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/tasks/task-1',
        query: { published: '1' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No action is needed right now')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'View activity' }));
    await expect(canvas.queryByText('No action is needed right now')).not.toBeInTheDocument();
  },
  render: () => (
    <div className="min-h-80 p-4 sm:p-8">
      <PublishedCelebration task={openTask} />
      <div id="task-activity" />
    </div>
  ),
};
