import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import {
  ACTION_INBOX_EVENT_NAME,
  type TimedActionInboxEvent,
} from '@/lib/market/action-inbox-events';

import type { TaskActionComponentProps } from './actions/types';
import { canViewAction, TaskActionsPanel } from './task-actions-panel';

const { account, invalidateActionQueue, refresh } = vi.hoisted(() => ({
  account: {
    address: '0x1111111111111111111111111111111111111111' as string | undefined,
    isConnected: true,
  },
  invalidateActionQueue: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
  // The branch's own `account` fixture, not a fresh literal: these tests switch it between
  // cases to exercise which actions a given viewer sees.
  useAccount: () => account,
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => invalidateActionQueue,
}));

vi.mock('@/components/market/fund-wallet-button', () => ({
  FundingGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PAID_ACTION_COST_BASE_UNITS: 1000n,
  usePaidActionFundingPrompt: () => ({
    actionFundingPrompt: null,
    recheckActionFunding: vi.fn(),
  }),
}));

vi.mock('@/components/market/actions', () => ({
  COMPONENT_BY_ACTION: {
    accept: ({ onSuccess }: TaskActionComponentProps) => (
      <button onClick={() => onSuccess?.()} type="button">
        run accept
      </button>
    ),
    cancel: () => <button type="button">fail cancel</button>,
    evaluate: ({ onSuccess }: TaskActionComponentProps) => (
      <button onClick={() => onSuccess?.()} type="button">
        run evaluate
      </button>
    ),
    finalize_verdict: ({ onSuccess }: TaskActionComponentProps) => (
      <button onClick={() => onSuccess?.()} type="button">
        run finalize
      </button>
    ),
    select_worker: ({ onSuccess }: TaskActionComponentProps) => (
      <button onClick={() => onSuccess?.()} type="button">
        run select worker
      </button>
    ),
    submit: () => <button type="button">Choose files</button>,
    rate: ({ action }: TaskActionComponentProps) => (
      <button type="button">Rate {action.targetWorker}</button>
    ),
    resolve_dispute: ({ onSuccess }: TaskActionComponentProps) => (
      <button onClick={() => onSuccess?.()} type="button">
        run resolve dispute
      </button>
    ),
  },
}));

const task = {
  claimedBy: '0x4444444444444444444444444444444444444444',
  disputeResolver: '0x3333333333333333333333333333333333333333',
  evaluator: '0x2222222222222222222222222222222222222222',
  id: 'task-1',
  requester: '0x1111111111111111111111111111111111111111',
  submissionVisibility: 'public',
} as unknown as TaskDetailResponse;

const action = { action: 'accept', role: 'requester', command: 'tm accept' } as PendingAction;

describe('TaskActionsPanel', () => {
  beforeEach(() => {
    refresh.mockReset();
    invalidateActionQueue.mockReset();
    invalidateActionQueue.mockResolvedValue(undefined);
    account.address = task.requester;
    account.isConnected = true;
  });

  it('invalidates the shared queue when a common action succeeds', async () => {
    const user = userEvent.setup();
    const selectWorker = {
      action: 'select_worker',
      role: 'requester',
      command: 'tm select-worker',
    } as PendingAction;
    render(
      <TaskActionsPanel
        emptyReason="none"
        pendingActions={[selectWorker]}
        requester={task.requester}
        task={task}
      />
    );

    await user.click(screen.getByRole('button', { name: /run select worker/i }));

    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
  });

  it('passes an onSuccess that calls router.refresh into the action component', async () => {
    const user = userEvent.setup();
    render(
      <TaskActionsPanel
        emptyReason="none"
        pendingActions={[action]}
        requester="0x1111111111111111111111111111111111111111"
        task={task}
      />
    );

    await user.click(screen.getByRole('button', { name: /run accept/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('emits one real lifecycle completion event when an action succeeds', async () => {
    const user = userEvent.setup();
    const events: TimedActionInboxEvent[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<TimedActionInboxEvent>).detail);
    };
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    render(
      <TaskActionsPanel
        emptyReason="none"
        pendingActions={[action]}
        requester={task.requester}
        task={task}
      />
    );

    await user.click(screen.getByRole('button', { name: /run accept/i }));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        action: 'accept',
        event: 'lifecycle_action_completed',
        taskId: task.id,
      })
    );
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('emits no lifecycle completion event when an action does not complete', async () => {
    const user = userEvent.setup();
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);
    const failedAction = {
      action: 'cancel',
      role: 'requester',
      command: 'tm cancel',
    } as PendingAction;

    render(
      <TaskActionsPanel
        emptyReason="none"
        pendingActions={[failedAction]}
        requester={task.requester}
        task={task}
      />
    );

    await user.click(screen.getByRole('button', { name: /fail cancel/i }));

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('shows public evidence evaluation only to the assigned evaluator', () => {
    const evaluateAction = {
      action: 'evaluate',
      role: 'evaluator',
      command: 'tm evaluate',
    } as PendingAction;
    account.address = task.evaluator ?? undefined;

    const { rerender } = render(
      <TaskActionsPanel
        emptyReason="none"
        evidenceReady
        pendingActions={[evaluateAction]}
        requester={task.requester}
        task={task}
      />
    );

    expect(screen.getByRole('button', { name: /run evaluate/i })).toBeInTheDocument();

    account.address = task.claimedBy ?? undefined;
    rerender(
      <TaskActionsPanel
        emptyReason="none"
        evidenceReady
        pendingActions={[evaluateAction]}
        requester={task.requester}
        task={task}
      />
    );

    expect(screen.queryByRole('button', { name: /run evaluate/i })).not.toBeInTheDocument();
  });

  it('hides evidence-dependent actions while the assigned wallet is disconnected', () => {
    const evaluateAction = {
      action: 'evaluate',
      role: 'evaluator',
      command: 'tm evaluate',
    } as PendingAction;
    account.address = undefined;
    account.isConnected = false;

    render(
      <TaskActionsPanel
        emptyReason="none"
        evidenceReady
        pendingActions={[evaluateAction]}
        requester={task.requester}
        task={task}
      />
    );

    expect(screen.queryByRole('button', { name: /run evaluate/i })).not.toBeInTheDocument();
    expect(screen.getByText('No actions for this wallet')).toBeInTheDocument();
  });

  it('shows public evidence dispute resolution only to the assigned resolver', () => {
    const resolveAction = {
      action: 'resolve_dispute',
      role: 'dispute_resolver',
      command: 'tm resolve-dispute',
    } as PendingAction;
    account.address = task.disputeResolver ?? undefined;

    render(
      <TaskActionsPanel
        emptyReason="none"
        evidenceReady
        pendingActions={[resolveAction]}
        requester={task.requester}
        task={task}
      />
    );

    expect(screen.getByRole('button', { name: /run resolve dispute/i })).toBeInTheDocument();
  });

  it.each(['evaluate', 'resolve_dispute'] as const)(
    'shows restricted %s only to its assigned role after evidence is ready',
    (actionName) => {
      const restrictedAction = {
        action: actionName,
        role: actionName === 'evaluate' ? 'evaluator' : 'dispute_resolver',
        command: `tm ${actionName}`,
      } as PendingAction;
      account.address =
        (actionName === 'evaluate' ? task.evaluator : task.disputeResolver) ?? undefined;

      const { rerender } = render(
        <TaskActionsPanel
          emptyReason="none"
          pendingActions={[restrictedAction]}
          requester={task.requester}
          task={{ ...task, submissionVisibility: 'never' }}
        />
      );

      expect(
        screen.queryByRole('button', { name: /run evaluate|run resolve dispute/i })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Decision evidence unavailable')).toBeInTheDocument();

      rerender(
        <TaskActionsPanel
          emptyReason="none"
          evidenceReady
          pendingActions={[restrictedAction]}
          requester={task.requester}
          task={{ ...task, submissionVisibility: 'never' }}
        />
      );

      expect(
        screen.getByRole('button', { name: /run evaluate|run resolve dispute/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('status', { name: 'Confidential evidence access' })
      ).toHaveTextContent(/current (evaluator|dispute resolver) assignment/i);
      expect(
        screen.getByRole('status', { name: 'Confidential evidence access' })
      ).toHaveTextContent(/does not publish the task or submissions/i);
    }
  );

  it('discloses evaluator role access when the task is private and submissions are public', () => {
    const evaluateAction = {
      action: 'evaluate',
      role: 'evaluator',
      command: 'tm evaluate',
    } as PendingAction;
    account.address = task.evaluator ?? undefined;

    render(
      <TaskActionsPanel
        emptyReason="none"
        evidenceReady
        pendingActions={[evaluateAction]}
        requester={task.requester}
        task={{ ...task, taskVisibility: 'private' }}
      />
    );

    expect(screen.getByRole('button', { name: /run evaluate/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Confidential evidence access' })).toHaveTextContent(
      /does not publish the task or submissions/i
    );
  });

  it('fails closed while public evidence has not loaded', () => {
    const evaluateAction = {
      action: 'evaluate',
      role: 'evaluator',
      command: 'tm evaluate',
    } as PendingAction;
    account.address = task.evaluator ?? undefined;

    render(
      <TaskActionsPanel
        emptyReason="No evaluator actions are available."
        pendingActions={[evaluateAction]}
        requester={task.requester}
        task={task}
      />
    );

    expect(screen.queryByRole('button', { name: /run evaluate/i })).not.toBeInTheDocument();
    expect(screen.getByText('Decision evidence unavailable')).toBeInTheDocument();
    expect(screen.getByText(/until the submitted evidence is visible/i)).toBeInTheDocument();
  });

  it('keeps requester, worker, and permissionless visibility behavior unchanged', () => {
    const requesterAction = {
      action: 'cancel',
      role: 'requester',
      command: 'tm cancel',
    } as PendingAction;
    const workerAction = {
      action: 'submit',
      role: 'worker',
      command: 'tm submit',
    } as PendingAction;
    const permissionlessAction = {
      action: 'finalize_verdict',
      role: 'anyone',
      command: 'tm finalize',
    } as PendingAction;

    expect(
      canViewAction({
        action: requesterAction,
        address: task.requester,
        requester: task.requester,
      })
    ).toBe(true);
    expect(
      canViewAction({
        action: workerAction,
        address: task.claimedBy ?? undefined,
        claimedBy: task.claimedBy,
        requester: task.requester,
      })
    ).toBe(true);
    expect(
      canViewAction({
        action: permissionlessAction,
        address: task.requester,
        requester: task.requester,
      })
    ).toBe(true);
  });

  it('shows permissionless actions to requester and worker wallets', () => {
    const permissionless = {
      action: 'select_winner',
      role: 'anyone',
      command: 'taskmarket task select-winner task-1',
      eligibleAddress: null,
    } as PendingAction;

    expect(
      canViewAction({
        action: permissionless,
        address: task.requester,
        requester: task.requester,
      })
    ).toBe(true);
    expect(
      canViewAction({
        action: permissionless,
        address: '0x2222222222222222222222222222222222222222',
        requester: task.requester,
      })
    ).toBe(true);
  });

  it('hides an appeal that has no eligible worker projection', () => {
    const appeal = {
      action: 'appeal',
      role: 'worker',
      command: 'taskmarket task appeal task-1',
      eligibleAddress: null,
    } as PendingAction;

    expect(
      canViewAction({
        action: appeal,
        address: '0x2222222222222222222222222222222222222222',
        requester: task.requester,
      })
    ).toBe(false);
  });

  it('groups split-payout rating actions under recipient progress', () => {
    const primary = '0x2222222222222222222222222222222222222222';
    const secondary = '0x3333333333333333333333333333333333333333';
    const third = '0x4444444444444444444444444444444444444444';
    const rateActions = [secondary, third].map(
      (targetWorker) =>
        ({
          action: 'rate',
          command: `tm rate --worker ${targetWorker}`,
          role: 'requester',
          targetWorker,
        }) as PendingAction
    );

    render(
      <TaskActionsPanel
        emptyReason="none"
        pendingActions={rateActions}
        requester={task.requester}
        task={{
          ...task,
          awards: [
            {
              workerAddress: primary,
              workerAgentId: null,
              workerActorType: 'agent',
              rank: 1,
              isPrimary: true,
              grossAmount: '2000000',
              workerPayment: '1900000',
              platformFee: '100000',
              settlementTxHash: '0xsettlement',
              settledAt: '2026-08-01T00:00:00.000Z',
              rating: 95,
            },
            ...[secondary, third].map((workerAddress, index) => ({
              workerAddress,
              workerAgentId: null,
              workerActorType: 'agent' as const,
              rank: index + 2,
              isPrimary: false,
              grossAmount: '1000000',
              workerPayment: '950000',
              platformFee: '50000',
              settlementTxHash: '0xsettlement',
              settledAt: '2026-08-01T00:00:00.000Z',
              rating: null,
            })),
          ],
        }}
      />
    );

    expect(screen.getByText('1 of 3 ratings recorded')).toBeInTheDocument();
    expect(
      screen.getByText(/2 ratings remaining before every payout recipient/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^rate 0x/i })).toHaveLength(2);
  });
});
