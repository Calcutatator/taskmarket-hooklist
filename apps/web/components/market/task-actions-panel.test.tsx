import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { canViewAction, TaskActionsPanel } from './task-actions-panel';
import type { TaskActionComponentProps } from './actions/types';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
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
    submit: () => <button type="button">Choose files</button>,
    rate: ({ action }: TaskActionComponentProps) => (
      <button type="button">Rate {action.targetWorker}</button>
    ),
  },
}));

const task = {
  id: 'task-1',
  requester: '0x1111111111111111111111111111111111111111',
} as unknown as TaskDetailResponse;

const action = { action: 'accept', role: 'requester', command: 'tm accept' } as PendingAction;

describe('TaskActionsPanel', () => {
  beforeEach(() => {
    refresh.mockReset();
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
