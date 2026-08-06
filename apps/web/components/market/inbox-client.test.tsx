import type { TaskActionQueueResponse, TaskResponse } from '@taskmarket/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTION_INBOX_EVENT_NAME,
  type TimedActionInboxEvent,
} from '@/lib/market/action-inbox-events';

const { accountState, queueState, useActionQueue, useReadAuthSignature } = vi.hoisted(() => ({
  accountState: {
    address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
    isConnected: true,
  },
  queueState: {
    callerScopedReady: true,
    data: undefined as TaskActionQueueResponse | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  useActionQueue: vi.fn(),
  useReadAuthSignature: vi.fn(() => true),
}));

vi.mock('wagmi', () => ({
  useAccount: () => accountState,
}));

vi.mock('@/lib/use-action-queue', () => ({
  useActionQueue,
}));

vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignature,
}));

vi.mock('@/components/privy-account-control', () => ({
  PrivyWalletAccessButton: () => <button type="button">Sign in</button>,
}));

import { InboxClient } from './inbox-client';

const task: TaskResponse = {
  auctionBidCount: 0,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  description: 'Audit the settlement workflow\nReview every completion edge case.',
  escrowTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiryTime: '2026-08-12T00:00:00.000Z',
  id: 'task-review',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  phase: 'active',
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: accountState.address!,
  requesterPubkey: accountState.address!,
  reward: '250000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 3,
  submissionVisibility: 'public',
  submissionWindowOpen: true,
  tags: ['audit'],
  taskVisibility: 'public',
};

const actionQueue: TaskActionQueueResponse = {
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
      task,
    },
  ],
  total: 1,
  urgentTotal: 1,
  waiting: [
    {
      dueAt: '2026-08-12T00:00:00.000Z',
      id: 'task-waiting:waiting_for_submissions',
      reason: 'waiting_for_submissions',
      role: 'requester',
      task: { ...task, description: 'Create launch illustrations', id: 'task-waiting' },
    },
  ],
};

describe('InboxClient', () => {
  beforeEach(() => {
    accountState.address = '0x1111111111111111111111111111111111111111';
    accountState.isConnected = true;
    queueState.data = actionQueue;
    queueState.callerScopedReady = true;
    queueState.isError = false;
    queueState.isLoading = false;
    queueState.refetch = vi.fn();
    useActionQueue.mockImplementation(() => queueState);
    useActionQueue.mockClear();
    useReadAuthSignature.mockClear();
  });

  it('shows grouped obligations separately from tasks waiting on other people', () => {
    render(<InboxClient />);

    const actions = screen.getByRole('region', { name: /needs your action/i });
    expect(within(actions).getByText('Review 3 submissions')).toBeVisible();
    expect(within(actions).getByText('Audit the settlement workflow')).toBeVisible();
    expect(within(actions).getByText('Urgent')).toBeVisible();

    const waiting = screen.getByRole('region', { name: /waiting on others/i });
    expect(within(waiting).getByText('Create launch illustrations')).toBeVisible();
    expect(within(waiting).getByText('Waiting for submissions')).toBeVisible();
  });

  it('intentionally verifies the Inbox wallet and enriches the shared action queue', () => {
    render(<InboxClient />);

    expect(useReadAuthSignature).toHaveBeenCalledWith(accountState.address);
    expect(useActionQueue).toHaveBeenCalledWith(accountState.address, {
      enabled: true,
      readAuthReady: true,
    });
  });

  it('emits queue viewed only after caller-scoped enrichment and once per wallet', () => {
    const events: TimedActionInboxEvent[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<TimedActionInboxEvent>).detail);
    };
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);
    queueState.callerScopedReady = false;
    queueState.data = { items: [], total: 0, urgentTotal: 0, waiting: [] };

    const { rerender } = render(<InboxClient />);
    expect(events).toHaveLength(0);

    queueState.callerScopedReady = true;
    queueState.data = actionQueue;
    rerender(<InboxClient />);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actionCount: 1, event: 'queue_viewed', waitingCount: 1 });

    queueState.data = { ...actionQueue, urgentTotal: 0 };
    rerender(<InboxClient />);
    expect(events).toHaveLength(1);

    accountState.address = '0x2222222222222222222222222222222222222222';
    queueState.callerScopedReady = false;
    rerender(<InboxClient />);
    expect(events).toHaveLength(1);

    queueState.callerScopedReady = true;
    queueState.data = { items: [], total: 0, urgentTotal: 0, waiting: [] };
    rerender(<InboxClient />);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ actionCount: 0, event: 'queue_viewed', waitingCount: 0 });
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('keeps a cached anonymous projection hidden during authenticated refresh', () => {
    queueState.callerScopedReady = false;
    queueState.data = { items: [], total: 0, urgentTotal: 0, waiting: [] };

    render(<InboxClient />);

    expect(screen.getByRole('region', { name: /loading inbox/i })).toBeVisible();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });

  it('does not emit a queue view for a disconnected anonymous scope', () => {
    const listener = vi.fn();
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);
    accountState.address = undefined;
    accountState.isConnected = false;
    queueState.callerScopedReady = false;

    render(<InboxClient />);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('offers a real sign-in action when no wallet is connected', () => {
    accountState.address = undefined;
    accountState.isConnected = false;

    render(<InboxClient />);

    expect(screen.getByRole('heading', { name: /connect to view your inbox/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeVisible();
    expect(useReadAuthSignature).toHaveBeenCalledWith(undefined);
    expect(useActionQueue).toHaveBeenCalledWith(undefined, {
      enabled: false,
      readAuthReady: true,
    });
  });

  it('shows a stable loading surface while the queue is being projected', () => {
    queueState.data = undefined;
    queueState.isLoading = true;

    render(<InboxClient />);

    expect(screen.getByRole('region', { name: /loading inbox/i })).toBeVisible();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });

  it('lets the user retry a failed queue read', async () => {
    const user = userEvent.setup();
    queueState.data = undefined;
    queueState.isError = true;

    render(<InboxClient />);
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/inbox unavailable/i);
    expect(queueState.refetch).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a first-use empty queue from tasks that are merely waiting', () => {
    queueState.data = { items: [], total: 0, urgentTotal: 0, waiting: [] };

    render(<InboxClient />);

    expect(screen.getByText(/all caught up/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByRole('link', { name: /browse tasks/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(screen.queryByRole('region', { name: /waiting on others/i })).not.toBeInTheDocument();
  });

  it('opens evidence-aware task activity instead of executing an action from the compact row', () => {
    render(<InboxClient />);

    expect(screen.getByRole('link', { name: /review 3 submissions/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-review?focus=review_work#task-activity'
    );
    expect(
      screen.queryByRole('button', { name: /accept|reject|release payment/i })
    ).not.toBeInTheDocument();
  });

  it.each([
    ['evaluate_work', 'evaluate', 'task-activity'],
    ['resolve_dispute', 'resolve_dispute', 'task-activity'],
    ['appeal_verdict', 'appeal', 'task-verdict'],
    ['finalize_verdict', 'finalize_verdict', 'task-verdict'],
  ] as const)('routes %s through its evidence-first task section', (intent, action, anchor) => {
    queueState.data = {
      items: [
        {
          actions: [
            { action, command: `taskmarket task ${action} task-review`, role: 'evaluator' },
          ],
          dueAt: null,
          id: `task-review:${intent}`,
          intent,
          priority: 'required',
          progress: null,
          role: action === 'resolve_dispute' ? 'dispute_resolver' : 'evaluator',
          task,
        },
      ],
      total: 1,
      urgentTotal: 0,
      waiting: [],
    };

    render(<InboxClient />);

    expect(screen.getByRole('link', { name: /open task/i })).toHaveAttribute(
      'href',
      `/dashboard/tasks/task-review?focus=${intent}#${anchor}`
    );
  });
});
