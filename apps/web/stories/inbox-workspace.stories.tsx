import type { ActivityFeedResponse, TaskActionQueueResponse } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { InboxQueueView } from '@/components/market/inbox-client';
import { NewsClient } from '@/components/market/news-client';

import { addresses, taskFixture } from './fixtures';

const reviewTask = taskFixture({
  description:
    'Audit the complete settlement workflow and document every state transition that needs review',
  id: 'task-review',
  requester: addresses.requester,
  requesterPubkey: addresses.requester,
  status: 'pending_approval',
  submissionCount: 3,
});

const mixedQueue: TaskActionQueueResponse = {
  items: [
    {
      actions: [
        {
          action: 'accept',
          command: 'taskmarket task accept task-review',
          role: 'requester',
        },
        {
          action: 'reject_submission',
          command: 'taskmarket task reject-submission task-review',
          role: 'requester',
        },
      ],
      dueAt: '2026-08-07T00:00:00.000Z',
      id: 'task-review:review_work',
      intent: 'review_work',
      priority: 'urgent',
      progress: { completed: 0, total: 3 },
      role: 'requester',
      task: reviewTask,
    },
    {
      actions: [
        {
          action: 'submit',
          command: 'taskmarket task submit task-delivery',
          role: 'worker',
        },
      ],
      dueAt: '2026-08-12T00:00:00.000Z',
      id: 'task-delivery:submit_work',
      intent: 'submit_work',
      priority: 'required',
      progress: null,
      role: 'worker',
      task: taskFixture({
        claimedBy: addresses.worker,
        description: 'Prepare a responsive launch-page implementation with verified keyboard flow',
        id: 'task-delivery',
        mode: 'claim',
        status: 'claimed',
      }),
    },
    {
      actions: [
        {
          action: 'rate',
          command: 'taskmarket task rate task-rating',
          role: 'requester',
          targetWorker: addresses.worker,
        },
      ],
      dueAt: null,
      id: 'task-rating:rate_workers',
      intent: 'rate_workers',
      priority: 'follow_up',
      progress: { completed: 1, total: 3 },
      role: 'requester',
      task: taskFixture({
        description:
          'Compare three onboarding prototypes and document the strongest interaction model',
        id: 'task-rating',
        phase: 'resolved',
        status: 'completed',
      }),
    },
  ],
  total: 3,
  urgentTotal: 1,
  waiting: [
    {
      dueAt: '2026-08-14T00:00:00.000Z',
      id: 'task-waiting:waiting_for_submissions',
      reason: 'waiting_for_submissions',
      role: 'requester',
      task: taskFixture({
        description: 'Create a launch illustration system for the Taskmarket protocol',
        id: 'task-waiting',
      }),
    },
  ],
};

const emptyQueue: TaskActionQueueResponse = {
  items: [],
  total: 0,
  urgentTotal: 0,
  waiting: [],
};

const waitingQueue: TaskActionQueueResponse = {
  ...emptyQueue,
  waiting: mixedQueue.waiting,
};

const activityFeed: ActivityFeedResponse = {
  items: [
    {
      actor: addresses.worker,
      actorType: 'agent',
      amount: '250000000',
      rating: null,
      taskId: reviewTask.id,
      taskTitle: 'Audit the complete settlement workflow',
      timestamp: '2026-08-06T03:15:00.000Z',
      type: 'task_submitted',
    },
  ],
  nextCursor: null,
};

function RetryableInbox() {
  const [failed, setFailed] = useState(true);
  return (
    <InboxQueueView
      connected
      data={failed ? undefined : emptyQueue}
      isError={failed}
      isLoading={false}
      onRetry={() => setFailed(false)}
    />
  );
}

const meta = {
  args: {
    connected: true,
    data: mixedQueue,
    isError: false,
    isLoading: false,
    onRetry: () => undefined,
  },
  component: InboxQueueView,
  parameters: {
    a11y: { test: 'error' },
    layout: 'padded',
  },
  title: 'Product/Action Inbox',
} satisfies Meta<typeof InboxQueueView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedPrioritiesAndWaiting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reviewLink = canvas.getByRole('link', { name: /review 3 submissions/i });
    await expect(reviewLink).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-review?focus=review_work#task-activity'
    );
    await expect(canvas.getByRole('region', { name: /waiting on others/i })).toBeVisible();
  },
};

export const AllCaughtUp: Story = {
  args: { data: emptyQueue },
};

export const WaitingWithoutAnActionCount: Story = {
  args: { data: waitingQueue },
};

export const Loading: Story = {
  args: { data: undefined, isLoading: true },
};

export const Disconnected: Story = {
  args: { connected: false, data: undefined },
};

export const ErrorAndRetry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /retry/i }));
    await expect(canvas.getByText(/all caught up/i)).toBeVisible();
  },
  render: () => <RetryableInbox />,
};

export const LongContentOnMobile: Story = {
  args: {
    data: {
      ...mixedQueue,
      items: [
        {
          ...mixedQueue.items[0]!,
          task: {
            ...reviewTask,
            description:
              'Review the exceptionally detailed internationalized settlement specification without losing the action or deadline at narrow widths',
          },
        },
      ],
      total: 1,
    },
  },
  parameters: { viewport: { defaultViewport: 'mobile' } },
};

export const InboxWithSecondaryMarketNews: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: /needs your action/i })).toHaveAttribute(
      'data-state',
      'active'
    );
    await userEvent.click(canvas.getByRole('tab', { name: /market news/i }));
    await expect(canvas.getByText('Audit the complete settlement workflow')).toBeVisible();
  },
  render: () => <NewsClient initialFeed={activityFeed} />,
};
