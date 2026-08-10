import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { BidForm } from './bid-form';

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
    address: '0x2222222222222222222222222222222222222222',
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

const task = { id: 'task-1', mode: 'auction' } as unknown as TaskDetailResponse;
const action = { action: 'bid', role: 'worker', command: 'tm bid' } as PendingAction;

describe('BidForm', () => {
  beforeEach(() => {
    payX402Post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submits on Enter and toasts success + calls onSuccess', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xabc' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<BidForm action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    await user.type(screen.getByLabelText(/your price/i), '5{Enter}');

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toBe('Bid placed');
  });

  it('associates a field error with the input via aria attributes', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<BidForm action={action} disabled={false} onSuccess={onSuccess} task={task} />);
    // Submit with an invalid (empty) price to trigger the field error.
    await user.click(screen.getByRole('button', { name: /place bid/i }));

    const input = screen.getByLabelText(/your price/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(/positive USDC/i);
    expect(payX402Post).not.toHaveBeenCalled();
  });
});
