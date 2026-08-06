import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { AcceptButton } from './accept-button';

const { invalidateActionQueue, payX402Post, toastSuccess, toastError, walletState } = vi.hoisted(
  () => ({
    invalidateActionQueue: vi.fn(),
    payX402Post: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    walletState: {
      address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
      isConnected: true,
    },
  })
);

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: walletState.address, isConnected: walletState.isConnected }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => invalidateActionQueue,
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
    invalidateActionQueue.mockReset();
    invalidateActionQueue.mockResolvedValue(undefined);
    toastSuccess.mockReset();
    toastError.mockReset();
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
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
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
    expect(invalidateActionQueue).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
