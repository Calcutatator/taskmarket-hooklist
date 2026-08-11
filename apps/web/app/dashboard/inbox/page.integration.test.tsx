import type { TaskActionQueueResponse, TaskResponse } from '@taskmarket/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueState, useActionQueue } = vi.hoisted(() => ({
  queueState: {
    callerScopedReady: true,
    data: undefined as TaskActionQueueResponse | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  useActionQueue: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    isConnected: true,
  }),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useActionQueue,
}));

vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignature: () => true,
}));

vi.mock('@/lib/api/server', () => ({
  fetchActivityFeed: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    stats: {
      activityFeed: {
        useInfiniteQuery: () => ({
          data: { pageParams: [undefined], pages: [{ items: [], nextCursor: null }] },
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isError: false,
          isFetchingNextPage: false,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import InboxPage from './page';

const task = {
  auctionBidCount: 0,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  description: 'Review the launch illustrations',
  escrowTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiryTime: '2026-08-12T00:00:00.000Z',
  id: 'task-publication-journey',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  phase: 'active',
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: '0x1111111111111111111111111111111111111111',
  requesterPubkey: '0x1111111111111111111111111111111111111111',
  reward: '250000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  submissionVisibility: 'public',
  submissionWindowOpen: true,
  tags: ['design'],
  taskVisibility: 'public',
} as TaskResponse;

const waitingQueue: TaskActionQueueResponse = {
  items: [],
  total: 0,
  urgentTotal: 0,
  waiting: [
    {
      dueAt: task.expiryTime,
      id: `${task.id}:waiting_for_submissions`,
      reason: 'waiting_for_submissions',
      role: 'requester',
      task,
    },
  ],
};

const reviewQueue: TaskActionQueueResponse = {
  items: [
    {
      actions: [
        {
          action: 'accept',
          command: `taskmarket task accept ${task.id}`,
          role: 'requester',
        },
        {
          action: 'reject_submission',
          command: `taskmarket task reject-submission ${task.id}`,
          role: 'requester',
        },
      ],
      dueAt: task.expiryTime,
      id: `${task.id}:review_work`,
      intent: 'review_work',
      priority: 'urgent',
      progress: { completed: 0, total: 2 },
      role: 'requester',
      task: { ...task, submissionCount: 2 },
    },
  ],
  total: 1,
  urgentTotal: 1,
  waiting: [],
};

describe('Inbox route lifecycle integration', () => {
  beforeEach(() => {
    queueState.data = waitingQueue;
    queueState.isError = false;
    queueState.isLoading = false;
    queueState.refetch = vi.fn();
    useActionQueue.mockImplementation(() => queueState);
  });

  it('moves a published task from non-counting waiting into one focused review action', async () => {
    const view = render(await InboxPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    expect(screen.getByRole('region', { name: /waiting on others/i })).toBeVisible();
    expect(screen.getByText('Waiting for submissions')).toBeVisible();
    expect(screen.queryByText('1 action')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review the launch illustrations/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-publication-journey#task-activity'
    );

    queueState.data = reviewQueue;
    view.rerender(await InboxPage());

    expect(screen.queryByRole('region', { name: /waiting on others/i })).not.toBeInTheDocument();
    expect(screen.getByText('1 action')).toBeVisible();
    expect(screen.getByRole('link', { name: /review 2 submissions/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-publication-journey?focus=review_work#task-activity'
    );
  });
});
