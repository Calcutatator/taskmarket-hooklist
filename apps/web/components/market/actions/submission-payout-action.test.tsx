import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { SubmissionPayoutAction } from './submission-payout-action';

const { account, authState, connectOrCreateWallet, login, payX402Post, refresh } = vi.hoisted(
  () => ({
    account: {
      address: undefined as `0x${string}` | undefined,
      isConnected: false,
    },
    authState: {
      authenticated: false,
      walletsReady: true,
    },
    connectOrCreateWallet: vi.fn(),
    login: vi.fn(),
    payX402Post: vi.fn(),
    refresh: vi.fn(),
  })
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => account,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund: vi.fn() }),
  usePrivy: () => ({
    authenticated: authState.authenticated,
    connectOrCreateWallet,
    login,
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: authState.walletsReady, wallets: [] }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

const task = {
  claimedBy: '0x2222222222222222222222222222222222222222',
  id: 'task-1',
  requester: '0x1111111111111111111111111111111111111111',
} as unknown as TaskDetailResponse;
const action = {
  action: 'accept',
  command: 'taskmarket task accept task-1',
  role: 'requester',
} as PendingAction;

describe('SubmissionPayoutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    account.address = undefined;
    account.isConnected = false;
    authState.authenticated = false;
    authState.walletsReady = true;
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xabc' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs in before connecting the requester wallet', async () => {
    const user = userEvent.setup();
    render(<SubmissionPayoutAction action={action} task={task} />);

    const signInButton = await screen.findByRole('button', { name: /^sign in$/i });
    await user.click(signInButton);

    expect(login).toHaveBeenCalledTimes(1);
    expect(connectOrCreateWallet).not.toHaveBeenCalled();
  });

  it('explains that payout uses the latest active submission', () => {
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;

    render(<SubmissionPayoutAction action={action} task={task} />);

    expect(
      screen.getByText('Releases payout to this worker using their latest active submission.')
    ).toBeInTheDocument();
  });

  it('confirms settlement with bounded refreshes and an explicit retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<SubmissionPayoutAction action={action} task={{ ...task, reward: '5000000' }} />);

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const releaseButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(releaseButtons[releaseButtons.length - 1]);

    expect(await screen.findByRole('status', { name: 'Confirming settlement' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Release payout' })).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(refresh.mock.calls.length).toBeGreaterThan(1);
    expect(refresh.mock.calls.length).toBeLessThan(20);
    expect(
      await screen.findByText('Settlement confirmation is taking longer than expected')
    ).toBeVisible();

    const refreshesBeforeRetry = refresh.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Check again' }));

    expect(screen.getByRole('status', { name: 'Confirming settlement' })).toBeVisible();
    expect(refresh).toHaveBeenCalledTimes(refreshesBeforeRetry + 1);
  });

  it('locks every payout control for the task after one worker is accepted', async () => {
    const sharedTask = { ...task, id: 'task-with-multiple-workers', reward: '5000000' };
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    const user = userEvent.setup();

    render(
      <>
        <SubmissionPayoutAction action={action} task={sharedTask} />
        <SubmissionPayoutAction
          action={{
            ...action,
            command:
              'taskmarket task accept task-with-multiple-workers --worker 0x3333333333333333333333333333333333333333',
          }}
          task={{ ...sharedTask, claimedBy: null }}
        />
      </>
    );

    const initialReleaseButtons = screen.getAllByRole('button', { name: 'Release payout' });
    await user.click(initialReleaseButtons[0]);
    const allReleaseButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(allReleaseButtons[allReleaseButtons.length - 1]);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Release payout' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: 'Confirming settlement' })).toHaveLength(2);
  });
});
