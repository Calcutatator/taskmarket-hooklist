import type { TaskActionQueueResponse, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = '0x1111111111111111111111111111111111111111' as const;
const requester = '0x2222222222222222222222222222222222222222' as const;

const {
  fetchActivityFeed,
  fetchMarketStats,
  fetchTask,
  fetchTaskModeData,
  invalidateActionQueue,
  queueState,
  refresh,
  signMessageAsync,
  useActionQueue,
} = vi.hoisted(() => ({
  fetchActivityFeed: vi.fn(async () => ({ items: [], nextCursor: null })),
  fetchMarketStats: vi.fn(async () => null),
  fetchTask: vi.fn(),
  fetchTaskModeData: vi.fn(async () => ({ submissions: [] })),
  invalidateActionQueue: vi.fn(async () => undefined),
  queueState: {
    callerScopedReady: true,
    data: undefined as TaskActionQueueResponse | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  refresh: vi.fn(),
  signMessageAsync: vi.fn(),
  useActionQueue: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: worker, isConnected: true }),
  useSignMessage: () => ({ signMessageAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useActionQueue,
  useInvalidateActionQueue: () => invalidateActionQueue,
}));

vi.mock('@/lib/api/server', () => ({
  fetchActivityFeed,
  fetchMarketStats,
  fetchTask,
  fetchTaskModeData,
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

vi.mock('@/components/market/fund-wallet-button', () => ({
  FundingGuard: ({ children }: { children: ReactNode }) => children,
  PAID_ACTION_COST_BASE_UNITS: 1000n,
  usePaidActionFundingPrompt: () => ({
    actionFundingPrompt: null,
    recheckActionFunding: vi.fn(),
  }),
}));

vi.mock('@/components/market/tasks', async () => {
  const { TaskActionsPanel } = await import('@/components/market/task-actions-panel');
  return {
    TaskDetailPanel: ({
      focusIntent,
      task,
    }: {
      focusIntent?: string;
      task: TaskDetailResponse;
    }) => (
      <main>
        <p>{focusIntent}</p>
        <TaskActionsPanel
          emptyReason="No appeal is available."
          pendingActions={task.pendingActions ?? []}
          requester={task.requester}
          task={task}
        />
      </main>
    ),
  };
});

import { clearCachedReadAuthHeaders, setCachedReadAuthHeaders } from '@/lib/read-auth';
import TaskDetailPage from '../tasks/[taskId]/page';
import InboxPage from './page';

const queueTask = {
  auctionBidCount: 0,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  description: 'Contest illustration verdict',
  escrowTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiryTime: '2026-08-12T00:00:00.000Z',
  id: 'contest-appeal-task',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  phase: 'active',
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester,
  requesterPubkey: requester,
  reward: '250000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'appealing',
  submissionCount: 2,
  submissionVisibility: 'public',
  submissionWindowOpen: false,
  tags: ['design'],
  taskVisibility: 'public',
} as TaskResponse;

const publicTask = {
  ...queueTask,
  pendingActions: [],
} as unknown as TaskDetailResponse;

const callerTask = {
  ...publicTask,
  pendingActions: [
    {
      action: 'appeal',
      command: `taskmarket task appeal ${queueTask.id}`,
      eligibleAddress: worker,
      role: 'worker',
    },
  ],
} as TaskDetailResponse;

const appealQueue: TaskActionQueueResponse = {
  items: [
    {
      actions: callerTask.pendingActions ?? [],
      dueAt: '2026-08-07T12:00:00.000Z',
      id: `${queueTask.id}:appeal_verdict`,
      intent: 'appeal_verdict',
      priority: 'urgent',
      progress: null,
      role: 'worker',
      task: queueTask,
    },
  ],
  total: 1,
  urgentTotal: 1,
  waiting: [],
};

describe('Inbox appeal route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueState.data = appealQueue;
    queueState.isError = false;
    queueState.isLoading = false;
    useActionQueue.mockImplementation(() => queueState);
    fetchTask.mockResolvedValue(publicTask);
    setCachedReadAuthHeaders(worker, {
      'X-Taskmarket-Caller-Address': worker,
      'X-Taskmarket-Caller-Signature': '0xcached-inbox-signature',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => callerTask,
        ok: true,
      }))
    );
  });

  afterEach(() => {
    clearCachedReadAuthHeaders();
    vi.unstubAllGlobals();
  });

  it('follows an Inbox appeal destination into the caller-scoped route and enables the real control', async () => {
    const user = userEvent.setup();
    const inbox = render(await InboxPage());
    const appealLink = screen.getByRole('link', { name: /contest illustration verdict/i });
    const href = appealLink.getAttribute('href');

    expect(href).toBe('/dashboard/tasks/contest-appeal-task?focus=appeal_verdict#task-verdict');

    inbox.unmount();
    const destination = new URL(href!, 'https://taskmarket.test');
    const encodedTaskId = destination.pathname.split('/').at(-1)!;
    render(
      await TaskDetailPage({
        params: Promise.resolve({ taskId: encodedTaskId }),
        searchParams: Promise.resolve({
          focus: destination.searchParams.get('focus') ?? undefined,
        }),
      })
    );

    expect(screen.getByText('appeal_verdict')).toBeVisible();
    const appealButton = await screen.findByRole('button', { name: 'Appeal verdict' });
    expect(appealButton).toBeEnabled();
    expect(signMessageAsync).not.toHaveBeenCalled();

    await user.click(appealButton);
    expect(screen.getByRole('dialog', { name: 'Appeal this verdict?' })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/tasks/contest-appeal-task', {
      headers: {
        accept: 'application/json',
        'X-Taskmarket-Caller-Address': worker,
        'X-Taskmarket-Caller-Signature': '0xcached-inbox-signature',
      },
      signal: expect.any(AbortSignal),
    });
  });
});
