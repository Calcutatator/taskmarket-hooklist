import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { RateForm } from './rate-form';

const { payX402Post, toastSuccess, toastError } = vi.hoisted(() => ({
  payX402Post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
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

const task = {
  id: 'task-1',
  worker: '0x2222222222222222222222222222222222222222',
  claimedBy: '0x2222222222222222222222222222222222222222',
} as unknown as TaskDetailResponse;
const action = { action: 'rate', role: 'requester', command: 'tm rate' } as PendingAction;

describe('RateForm', () => {
  beforeEach(() => {
    payX402Post.mockReset();
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
    expect(toastSuccess.mock.calls[0][0]).toBe('Rating recorded');
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
