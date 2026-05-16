import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateTaskClient } from './create-task-client';

const { connectOrCreateWallet, fund, router, walletState } = vi.hoisted(() => ({
  connectOrCreateWallet: vi.fn(),
  fund: vi.fn(),
  router: {
    push: vi.fn(),
  },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    isConnected: walletState.isConnected,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund }),
  usePrivy: () => ({
    authenticated: walletState.isConnected,
    connectOrCreateWallet,
    ready: true,
  }),
}));

describe('CreateTaskClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    connectOrCreateWallet.mockClear();
    fund.mockClear();
    router.push.mockClear();
    walletState.address = undefined;
    walletState.isConnected = false;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('connects a wallet inline before submitting a new task', async () => {
    const user = userEvent.setup();
    render(<CreateTaskClient />);

    await user.click(screen.getByRole('button', { name: /connect wallet to create/i }));

    expect(connectOrCreateWallet).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/connect a wallet in the header/i)).not.toBeInTheDocument();
  });

  it('prompts users to add USDC before x402 signing when balance is too low', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balanceBaseUnits: '1000000', balanceUsdc: '1.000000' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward$/i), '25');
    await user.click(screen.getByRole('button', { name: /^create task$/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/wallet/balance?address=0x1234567890abcdef1234567890abcdef12345678'
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    expect(screen.getByText(/wallet has 1\.000000 usdc/i)).toBeInTheDocument();
  });

  it('skips fiat preflight when fiat onboarding is disabled', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({}),
      ok: true,
      status: 500,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward$/i), '25');
    await user.click(screen.getByRole('button', { name: /^create task$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/wallet/balance?address=0x1234567890abcdef1234567890abcdef12345678'
    );
    expect(screen.queryByRole('button', { name: /add usdc/i })).not.toBeInTheDocument();
  });
});
