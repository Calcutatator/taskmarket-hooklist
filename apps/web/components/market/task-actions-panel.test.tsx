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
});
