import type { TaskDetailResponse } from '@taskmarket/shared';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accountState, signMessageAsync } = vi.hoisted(() => ({
  accountState: {
    address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
    isConnected: true,
  },
  signMessageAsync: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => accountState,
  useSignMessage: () => ({ signMessageAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/market/fund-wallet-button', () => ({
  FundingGuard: ({ children }: { children: ReactNode }) => children,
  PAID_ACTION_COST_BASE_UNITS: 1000n,
  usePaidActionFundingPrompt: () => ({
    actionFundingPrompt: null,
    recheckActionFunding: vi.fn(),
  }),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => vi.fn(),
}));

vi.mock('@/components/market/tasks', async () => {
  const { TaskActionsPanel } = await import('@/components/market/task-actions-panel');
  return {
    TaskDetailPanel: ({
      focusIntent,
      marketStats,
      modeData,
      task,
    }: {
      focusIntent?: string;
      marketStats?: { activeTasks: number } | null;
      modeData?: { submissions?: unknown[] };
      task: TaskDetailResponse;
    }) => (
      <div>
        <p>
          {task.pendingActions?.some((action) => action.action === 'appeal')
            ? 'Caller task'
            : 'Public task'}
        </p>
        <p>{task.pendingActions?.find((action) => action.action === 'appeal')?.eligibleAddress}</p>
        <p>{focusIntent}</p>
        <p>{marketStats?.activeTasks} active tasks</p>
        <p>{modeData?.submissions?.length} submissions</p>
        <TaskActionsPanel
          emptyReason="No appeal is available."
          pendingActions={task.pendingActions ?? []}
          requester={task.requester}
          task={task}
        />
      </div>
    ),
  };
});

import { clearCachedReadAuthHeaders, setCachedReadAuthHeaders } from '@/lib/read-auth';
import { CallerScopedTaskDetail } from './caller-scoped-task-detail';

const address = '0x1111111111111111111111111111111111111111' as const;
const otherAddress = '0x2222222222222222222222222222222222222222' as const;
const publicTask = {
  id: 'contest-task',
  pendingActions: [],
} as unknown as TaskDetailResponse;
const callerTask = {
  ...publicTask,
  pendingActions: [
    {
      action: 'appeal',
      command: 'taskmarket task appeal contest-task',
      eligibleAddress: address,
      role: 'worker',
    },
  ],
} as TaskDetailResponse;

function callerTaskFor(eligibleAddress: `0x${string}`): TaskDetailResponse {
  return {
    ...callerTask,
    pendingActions: callerTask.pendingActions?.map((action) => ({
      ...action,
      eligibleAddress,
    })),
  };
}

describe('CallerScopedTaskDetail', () => {
  beforeEach(() => {
    accountState.address = address;
    accountState.isConnected = true;
    signMessageAsync.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    setCachedReadAuthHeaders(address, {
      'X-Taskmarket-Caller-Address': address,
      'X-Taskmarket-Caller-Signature': '0xinbox-signature',
    });
  });

  afterEach(() => {
    clearCachedReadAuthHeaders();
    vi.unstubAllGlobals();
  });

  it('keeps the server task visible, then hydrates the Inbox appeal without signing again', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => callerTask,
      ok: true,
    } as Response);

    render(
      <CallerScopedTaskDetail
        focusIntent="appeal_verdict"
        marketStats={{ activeTasks: 7 } as never}
        modeData={{ submissions: [{ id: 'submission-1' }] } as never}
        task={publicTask}
      />
    );

    expect(screen.getByText('Public task')).toBeInTheDocument();
    expect(screen.getByText('appeal_verdict')).toBeInTheDocument();

    expect(await screen.findByText('Caller task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appeal verdict' })).toBeEnabled();
    expect(screen.getByText('7 active tasks')).toBeInTheDocument();
    expect(screen.getByText('1 submissions')).toBeInTheDocument();
    expect(signMessageAsync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/tasks/contest-task', {
        headers: {
          accept: 'application/json',
          'X-Taskmarket-Caller-Address': address,
          'X-Taskmarket-Caller-Signature': '0xinbox-signature',
        },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('keeps the public task without prompting when no reusable proof exists', async () => {
    clearCachedReadAuthHeaders();

    render(<CallerScopedTaskDetail task={publicTask} />);

    expect(screen.getByText('Public task')).toBeInTheDocument();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it('hydrates restricted submissions with the same caller proof as the assigned action', async () => {
    const restrictedTask = {
      ...callerTask,
      evaluator: address,
      mode: 'bounty',
      pendingActions: [
        {
          action: 'evaluate',
          command: 'taskmarket task evaluate contest-task',
          role: 'evaluator',
        },
      ],
      submissionCount: 2,
      submissionVisibility: 'never',
    } as TaskDetailResponse;
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => restrictedTask, ok: true } as Response)
      .mockResolvedValueOnce({
        json: async () => [{ id: 'submission-1' }, { id: 'submission-2' }],
        ok: true,
      } as Response);

    render(<CallerScopedTaskDetail modeData={{ submissions: [] }} task={publicTask} />);

    expect(await screen.findByText('2 submissions')).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/tasks/contest-task', {
      headers: {
        accept: 'application/json',
        'X-Taskmarket-Caller-Address': address,
        'X-Taskmarket-Caller-Signature': '0xinbox-signature',
      },
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/tasks/contest-task/submissions?includePreviewUrls=media',
      {
        headers: {
          accept: 'application/json',
          'X-Taskmarket-Caller-Address': address,
          'X-Taskmarket-Caller-Signature': '0xinbox-signature',
        },
        signal: expect.any(AbortSignal),
      }
    );
    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it('never renders a late projection from the previous wallet', async () => {
    let resolveFirstFetch: ((response: Response) => void) | undefined;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockResolvedValueOnce({
        json: async () => callerTaskFor(otherAddress),
        ok: true,
      } as Response);
    const view = render(<CallerScopedTaskDetail task={publicTask} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    setCachedReadAuthHeaders(otherAddress, {
      'X-Taskmarket-Caller-Address': otherAddress,
      'X-Taskmarket-Caller-Signature': '0xother-signature',
    });
    accountState.address = otherAddress;
    view.rerender(<CallerScopedTaskDetail task={publicTask} />);

    expect(await screen.findByText(otherAddress)).toBeInTheDocument();

    resolveFirstFetch?.({
      json: async () => callerTaskFor(address),
      ok: true,
    } as Response);

    await waitFor(() => expect(screen.queryByText(address)).not.toBeInTheDocument());
    expect(screen.getByText(otherAddress)).toBeInTheDocument();
    expect(signMessageAsync).not.toHaveBeenCalled();
  });
});
