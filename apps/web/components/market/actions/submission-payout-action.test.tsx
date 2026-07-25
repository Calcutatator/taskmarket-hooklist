import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { SubmissionPayoutAction } from './submission-payout-action';

const { account, authState, connectOrCreateWallet, login } = vi.hoisted(() => ({
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
}));

vi.mock('wagmi', () => ({
  useAccount: () => account,
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

const task = {
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
  });

  it('signs in before connecting the requester wallet', async () => {
    const user = userEvent.setup();
    render(<SubmissionPayoutAction action={action} task={task} />);

    const signInButton = await screen.findByRole('button', { name: /^sign in$/i });
    await user.click(signInButton);

    expect(login).toHaveBeenCalledTimes(1);
    expect(connectOrCreateWallet).not.toHaveBeenCalled();
  });
});
