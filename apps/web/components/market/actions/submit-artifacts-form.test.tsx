import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { SubmitArtifactsForm } from './submit-artifacts-form';

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x2222222222222222222222222222222222222222',
    isConnected: true,
  }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  // RFC-0006: /submissions/from-keys can now return a 402 past the free allowance,
  // so the form falls back to payX402Post (@/lib/x402-client), which needs these two.
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

const action = {
  action: 'submit',
  command: 'taskmarket task submit task-1 --file <path>',
  role: 'worker',
} as PendingAction;

function renderForm(taskOverrides: Partial<TaskDetailResponse> = {}) {
  const task = {
    id: 'task-1',
    ...taskOverrides,
  } as TaskDetailResponse;

  render(<SubmitArtifactsForm action={action} disabled={false} task={task} />);
}

describe('SubmitArtifactsForm DREAMS reminder', () => {
  it('presents a non-zero DREAMS amount as an estimated, conditional bonus', () => {
    renderForm({
      estimatedWorkerDreamsBonus: (200n * 10n ** 18n).toString(),
      estimatedWorkerUsdBonusValue: '60000',
    });

    expect(
      screen.getByText(
        /you may receive an estimated 0\.06 usdc \(~200 dreams\) bonus after completing this task/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /learn how dreams bonus eligibility works/i,
      })
    ).toBeInTheDocument();
  });

  it('shows a non-zero DREAMS estimate when its USDC equivalent rounds to zero', () => {
    renderForm({
      estimatedWorkerDreamsBonus: (200n * 10n ** 18n).toString(),
      estimatedWorkerUsdBonusValue: '0',
    });

    expect(
      screen.getByText(/you may receive an estimated 200 dreams bonus after completing this task/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /learn how dreams bonus eligibility works/i,
      })
    ).toBeInTheDocument();
  });

  it.each([
    ['missing estimates', {}],
    [
      'a zero DREAMS estimate',
      {
        estimatedWorkerDreamsBonus: '0',
        estimatedWorkerUsdBonusValue: '60000',
      },
    ],
  ])('omits the reminder and disclosure for %s', (_name, taskOverrides) => {
    renderForm(taskOverrides);

    expect(screen.queryByText(/estimated.*dreams/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /learn how dreams bonus eligibility works/i,
      })
    ).not.toBeInTheDocument();
  });
});
