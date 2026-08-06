import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { RateForm } from './rate-form';

const { invalidateActionQueue, payX402Post, toastSuccess, toastError } = vi.hoisted(() => ({
  invalidateActionQueue: vi.fn(),
  payX402Post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    isConnected: true,
  }),
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

const task = {
  id: 'task-1',
  worker: '0x2222222222222222222222222222222222222222',
  claimedBy: '0x2222222222222222222222222222222222222222',
} as unknown as TaskDetailResponse;
const action = { action: 'rate', role: 'requester', command: 'tm rate' } as PendingAction;

describe('RateForm', () => {
  beforeEach(() => {
    payX402Post.mockReset();
    invalidateActionQueue.mockReset();
    invalidateActionQueue.mockResolvedValue(undefined);
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submits on Enter from the rating input and toasts success', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xabc' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<RateForm action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    const input = screen.getByLabelText(/rating/i);
    input.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toBe('Rating recorded');
  });

  it('keeps the rating available and the queue unchanged when submission fails', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Rating service unavailable' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<RateForm action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    await user.click(screen.getByRole('button', { name: /submit rating/i }));

    expect(await screen.findByText('Rating service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeEnabled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(invalidateActionQueue).not.toHaveBeenCalled();
  });

  it('wires aria-invalid on the rating input (no error when valid)', () => {
    render(<RateForm action={action} disabled={false} onSuccess={vi.fn()} task={task} />);
    const input = screen.getByLabelText(/rating/i);
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('submits the award recipient targeted by the pending action', async () => {
    const targetWorker = '0x3333333333333333333333333333333333333333';
    payX402Post.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();

    render(
      <RateForm
        action={{ ...action, targetWorker }}
        disabled={false}
        onSuccess={vi.fn()}
        task={task}
      />
    );
    expect(screen.getByText(/0x3333.*3333/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ worker: targetWorker })
    );
  });
});
