import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { ClaimButton } from './claim-button';

const { signAndPost, toastSuccess, toastError } = vi.hoisted(() => ({
  signAndPost: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x2222222222222222222222222222222222222222',
    isConnected: true,
  }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock('@/lib/wallet-sign-action', () => ({
  signAndPost: (...args: unknown[]) => signAndPost(...args),
}));

const task = { id: 'task-1' } as unknown as TaskDetailResponse;
const action = { action: 'claim', role: 'worker', command: 'tm claim' } as PendingAction;

describe('ClaimButton', () => {
  beforeEach(() => {
    signAndPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('calls onSuccess once and toasts success on a successful claim', async () => {
    signAndPost.mockResolvedValue({ ok: true, data: { claimId: 'c1' } });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<ClaimButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    await user.click(screen.getByRole('button', { name: /claim task/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('Claimed');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not call onSuccess and toasts error on failure', async () => {
    signAndPost.mockResolvedValue({ ok: false, error: 'nope' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<ClaimButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    await user.click(screen.getByRole('button', { name: /claim task/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('nope'));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not toast on a user-rejected claim', async () => {
    signAndPost.mockResolvedValue({ ok: false, error: 'Cancelled in wallet', rejected: true });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<ClaimButton action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    await user.click(screen.getByRole('button', { name: /claim task/i }));

    await waitFor(() => expect(signAndPost).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
