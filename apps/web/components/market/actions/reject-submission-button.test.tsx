import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { RejectSubmissionButton } from './reject-submission-button';

const {
  account,
  payX402Post,
  toastError,
  toastSuccess,
  useFiatOnramp,
  useSignTypedData,
  useSwitchChain,
} = vi.hoisted(() => ({
  account: {
    address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
    isConnected: true,
  },
  payX402Post: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useFiatOnramp: vi.fn(() => ({ fund: vi.fn() })),
  useSignTypedData: vi.fn(),
  useSwitchChain: vi.fn(),
}));

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
  useAccount: () => account,
  useSignTypedData: () => ({ signTypedDataAsync: useSignTypedData }),
  useSwitchChain: () => ({ switchChainAsync: useSwitchChain }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp,
  usePrivy: () => ({
    authenticated: false,
    connectOrCreateWallet: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

const requester = '0x1111111111111111111111111111111111111111';
const selectedWorker = '0x2222222222222222222222222222222222222222';
const suggestedWorker = '0x3333333333333333333333333333333333333333';

const task = {
  id: 'task-1',
  requester,
} as unknown as TaskDetailResponse;

const action = {
  action: 'reject_submission',
  command: `taskmarket task reject-submission task-1 --worker ${suggestedWorker}`,
  role: 'requester',
} as PendingAction;

const target = {
  activeSubmissionCount: 12,
  workerAddress: selectedWorker,
};

describe('RejectSubmissionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    account.address = requester;
    account.isConnected = true;
    payX402Post.mockResolvedValue({ ok: true, txHash: '0xabc' });
  });

  it('requires confirmation before targeting all submissions from the selected worker', async () => {
    const user = userEvent.setup();

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={vi.fn()}
        target={target}
        task={task}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    );

    expect(payX402Post).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Reject this submitter?' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      `All 12 submissions from ${selectedWorker} will be rejected. This worker cannot submit again to this task.`
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('The relay fee is 0.001 USDC.');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(payX402Post).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('uses the explicit target and reports normalized success before closing confirmation', async () => {
    const user = userEvent.setup();
    const onRejectSuccess = vi.fn(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const onSuccess = vi.fn();

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={onRejectSuccess}
        onSuccess={onSuccess}
        target={target}
        task={task}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    );
    await user.click(screen.getByRole('button', { name: 'Reject all submissions' }));

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0][1]).toEqual({
      taskId: 'task-1',
      worker: selectedWorker,
    });
    expect(onRejectSuccess).toHaveBeenCalledWith(selectedWorker.toLowerCase());
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('blocks a connected wallet that is not the requester', () => {
    account.address = '0x4444444444444444444444444444444444444444';

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={vi.fn()}
        target={target}
        task={task}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    ).toBeDisabled();
    expect(screen.getByText('Connect the requester wallet to reject submissions.')).toBeVisible();
  });

  it('requires a connected requester wallet in grouped target mode', () => {
    account.address = undefined;
    account.isConnected = false;

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={vi.fn()}
        target={target}
        task={task}
      />
    );

    expect(
      screen.getByText('Connect the requester wallet to reject submissions.')
    ).toBeInTheDocument();
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('blocks the paid rejection when the requester wallet lacks the relay fee', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ balanceBaseUnits: '0', balanceUsdc: '0' }),
        ok: true,
      })
    );

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={vi.fn()}
        target={target}
        task={task}
      />
    );

    expect(
      await screen.findByText(/add 0\.001 usdc before rejecting this submitter/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    ).toBeDisabled();
  });

  it('keeps wallet rejection quiet and leaves the action available', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'User rejected request', rejected: true });
    const user = userEvent.setup();

    render(
      <RejectSubmissionButton
        action={action}
        disabled={false}
        onRejectSuccess={vi.fn()}
        target={target}
        task={task}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    );
    await user.click(screen.getByRole('button', { name: 'Reject all submissions' }));

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Reject submitter and all 12 submissions' })
    ).toBeEnabled();
  });

  it('retains command parsing for the generic task action path', async () => {
    const user = userEvent.setup();

    render(
      <RejectSubmissionButton action={action} disabled={false} onSuccess={vi.fn()} task={task} />
    );

    await user.click(screen.getByRole('button', { name: 'Reject submission' }));

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0][1]).toEqual({
      taskId: 'task-1',
      worker: suggestedWorker,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
