import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import {
  ACTION_INBOX_EVENT_NAME,
  emitActionInboxEvent,
  type TimedActionInboxEvent,
} from '@/lib/market/action-inbox-events';
import {
  clearCachedReadAuthHeaders,
  getCachedReadAuthAddress,
  setCachedReadAuthHeaders,
} from '@/lib/read-auth';

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
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
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
    clearCachedReadAuthHeaders();
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

  it('clears caller-scoped auth before switching a connected wallet', async () => {
    const otherWallet = '0x2222222222222222222222222222222222222222' as const;
    account.address = otherWallet;
    account.isConnected = true;
    authState.authenticated = true;
    setCachedReadAuthHeaders(otherWallet, { 'X-Taskmarket-Caller-Signature': '0xproof' });
    const user = userEvent.setup();

    render(<SubmissionPayoutAction action={action} task={task} />);
    await user.click(screen.getByRole('button', { name: /release payout options/i }));
    await user.click(screen.getByRole('button', { name: /switch wallet/i }));

    expect(getCachedReadAuthAddress()).toBeNull();
    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
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

  it('emits lifecycle completion exactly once when a parent owns completion telemetry', async () => {
    const telemetryTask = { ...task, id: 'task-parent-telemetry', reward: '5000000' };
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    const user = userEvent.setup();
    const events: TimedActionInboxEvent[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<TimedActionInboxEvent>).detail);
    };
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    render(
      <SubmissionPayoutAction
        action={action}
        onSuccess={() =>
          emitActionInboxEvent({
            action: action.action,
            event: 'lifecycle_action_completed',
            taskId: telemetryTask.id,
          })
        }
        task={telemetryTask}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const confirmationButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(confirmationButtons[confirmationButtons.length - 1]);

    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual(
      expect.objectContaining({
        action: 'accept',
        event: 'lifecycle_action_completed',
        taskId: telemetryTask.id,
      })
    );
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('emits one lifecycle completion event when rendered as the standalone payout owner', async () => {
    const telemetryTask = { ...task, id: 'task-standalone-telemetry', reward: '5000000' };
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    const user = userEvent.setup();
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    render(<SubmissionPayoutAction action={action} task={telemetryTask} />);

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const confirmationButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(confirmationButtons[confirmationButtons.length - 1]);

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it.each([
    ['failed', { ok: false, error: 'Settlement failed' }],
    ['cancelled', { ok: false, error: 'Cancelled in wallet', rejected: true }],
    ['stale', { ok: false, error: 'Action is no longer available' }],
  ])('emits no completion event for a %s payout', async (_label, result) => {
    const telemetryTask = { ...task, id: `task-${_label}-telemetry`, reward: '5000000' };
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    payX402Post.mockResolvedValueOnce(result);
    const user = userEvent.setup();
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    render(<SubmissionPayoutAction action={action} task={telemetryTask} />);

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const confirmationButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(confirmationButtons[confirmationButtons.length - 1]);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });

  it('emits no completion event when payout validation blocks submission', async () => {
    const telemetryTask = {
      ...task,
      claimedBy: null,
      id: 'task-validation-telemetry',
      reward: '5000000',
    };
    account.address = task.requester as `0x${string}`;
    account.isConnected = true;
    const user = userEvent.setup();
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    render(<SubmissionPayoutAction action={action} task={telemetryTask} />);

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const confirmationButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(confirmationButtons[confirmationButtons.length - 1]);

    expect(await screen.findByText('No worker on this task')).toBeVisible();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });
});
