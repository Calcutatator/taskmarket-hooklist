import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, connectOrCreateWallet, login } = vi.hoisted(() => ({
  authState: {
    authenticated: false,
    walletAddress: undefined as `0x${string}` | undefined,
    walletsReady: true,
  },
  connectOrCreateWallet: vi.fn(),
  login: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({
    authenticated: authState.authenticated,
    connectOrCreateWallet,
    login,
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({
    ready: authState.walletsReady,
    wallets: authState.walletAddress
      ? [{ address: authState.walletAddress, walletClientType: 'privy' }]
      : [],
  }),
}));

import { ConnectPrompt } from './connect-prompt';

describe('ConnectPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    authState.authenticated = false;
    authState.walletAddress = undefined;
    authState.walletsReady = true;
    vi.useRealTimers();
  });

  it('offers newcomer-friendly sign-in before a task action', async () => {
    const user = userEvent.setup();
    render(<ConnectPrompt />);

    expect(screen.getByText(/use email, google, or an existing wallet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('lets an authenticated user connect a wallet before a task action', async () => {
    const user = userEvent.setup();
    authState.authenticated = true;

    render(<ConnectPrompt />);

    await user.click(screen.getByRole('button', { name: /^connect wallet$/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it('offers recovery when an authenticated user wallet list stops loading', async () => {
    vi.useFakeTimers();
    authState.authenticated = true;
    authState.walletsReady = false;

    render(<ConnectPrompt />);

    expect(screen.getByRole('button', { name: /^loading wallet$/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^connect wallet$/i })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(8000));

    expect(screen.getByRole('button', { name: /^retry wallet$/i })).toBeEnabled();
  });

  it('reconnects an authenticated Privy wallet before wagmi can sign', async () => {
    const user = userEvent.setup();
    authState.authenticated = true;
    authState.walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

    render(<ConnectPrompt />);

    await user.click(screen.getByRole('button', { name: /^connect wallet$/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it('reports wallet access as unavailable when Privy is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '');

    render(<ConnectPrompt />);

    expect(screen.getByRole('button', { name: /^sign in unavailable$/i })).toBeDisabled();
  });
});
