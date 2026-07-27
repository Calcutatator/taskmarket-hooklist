import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { UpdateForm } from './update-form';

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    isConnected: true,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: vi.fn(),
}));

const description = 'Update this task';
const task = {
  description,
  expiryTime: '2026-08-01T00:00:00.000Z',
  id: 'task-1',
  mode: 'bounty',
  reward: '5000000',
  tags: ['design'],
} as unknown as TaskDetailResponse;
const action = { action: 'update', role: 'requester', command: 'tm update' } as PendingAction;

describe('UpdateForm', () => {
  it('allows task descriptions up to 10000 characters and shows the current count', () => {
    render(<UpdateForm action={action} disabled={false} task={task} />);

    expect(screen.getByLabelText(/description/i)).toHaveAttribute('maxlength', '10000');
    expect(screen.getByText(`${description.length} / 10000`)).toBeInTheDocument();
  });
});
