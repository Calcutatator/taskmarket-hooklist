import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { AcceptButton } from './accept-button';

const { payX402Post, toastSuccess, toastError, toastInfo, routerRefresh, walletState } = vi.hoisted(
  () => ({
    payX402Post: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    routerRefresh: vi.fn(),
    walletState: {
      address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
      isConnected: true,
    },
  })
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
  useAccount: () => ({ address: walletState.address, isConnected: walletState.isConnected }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

const worker = '0x2222222222222222222222222222222222222222';

const task = {
  id: 'task-1',
  requester: '0x1111111111111111111111111111111111111111',
  worker,
  claimedBy: worker,
  reward: '5000000',
  mode: 'standard',
} as unknown as TaskDetailResponse;

const action = { action: 'accept', role: 'requester', command: 'tm accept' } as PendingAction;

describe('AcceptButton', () => {
  beforeEach(() => {
    payX402Post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    routerRefresh.mockReset();
    walletState.address = '0x1111111111111111111111111111111111111111';
    walletState.isConnected = true;
  });

  it('never calls window.confirm and confirms via dialog before releasing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xabc' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<AcceptButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);

    await user.click(screen.getByRole('button', { name: /release payout/i }));
    // Dialog opens; confirm via the dialog's confirm button.
    const confirmButtons = await screen.findAllByRole('button', { name: /release payout/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toBe('Payout released');
    confirmSpy.mockRestore();
  });

  it('shows a toast error and does not call onSuccess on failure', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'boom' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<AcceptButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);

    await user.click(screen.getByRole('button', { name: /release payout/i }));
    const confirmButtons = await screen.findAllByRole('button', { name: /release payout/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('boom'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // The whole point of the in-flight outcome: it is not a failure, and the surface that shows
  // it must give the user nothing to press. Pressing again here would be a second payment.
  it('renders the in-flight notice with no control at all, and reports neither outcome', async () => {
    payX402Post.mockResolvedValue({
      ok: false,
      pending: true,
      idempotencyKey: '9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e',
      error:
        'Server wallet transaction 0xabc (nonce 12) was broadcast but not confirmed within the request budget; it remains in flight',
    });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<AcceptButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);

    await user.click(screen.getByRole('button', { name: /release payout/i }));
    const confirmButtons = await screen.findAllByRole('button', { name: /release payout/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(screen.getByText('Payout release submitted, confirming')).toBeInTheDocument()
    );
    expect(screen.getByText(/not a success and not a failure/)).toBeInTheDocument();
    // The reference the user can quote to support.
    expect(screen.getByText(/9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e/i)).toBeInTheDocument();

    // No retry, and no control of any kind that could re-trigger the paid write.
    expect(screen.queryByRole('button')).toBeNull();

    // Neither a success nor a failure was claimed.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith('Payout release submitted, confirming');
  });

  // The key must be stable across attempts, or a resubmission buys a second write instead of
  // presenting the one the backend already has.
  it('sends a stable idempotency key with the paid write', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xabc' });
    const user = userEvent.setup();

    render(<AcceptButton action={action} disabled={false} task={task} />);

    await user.click(screen.getByRole('button', { name: /release payout/i }));
    const confirmButtons = await screen.findAllByRole('button', { name: /release payout/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    const idempotencyKey = payX402Post.mock.calls[0][4];
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
