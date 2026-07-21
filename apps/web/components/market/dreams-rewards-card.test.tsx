import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DreamsRewardsCard } from './dreams-rewards-card';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const { balanceData, rateData, signMessageAsync, walletState, withdrawalAddressData } = vi.hoisted(
  () => ({
    balanceData: { current: { claimableBaseUnits: '0' } as { claimableBaseUnits: string } },
    rateData: {
      current: undefined as { dreamsPerUsdc: string; workerSplitBps: number } | undefined,
    },
    signMessageAsync: vi.fn(),
    walletState: {
      address: undefined as `0x${string}` | undefined,
      isConnected: false,
    },
    withdrawalAddressData: {
      current: { withdrawalAddress: null } as { withdrawalAddress: string | null },
    },
  })
);

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: walletState.address, isConnected: walletState.isConnected }),
  useSignMessage: () => ({ signMessageAsync }),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    wallet: {
      dreamsBalance: {
        useQuery: () => ({
          data: balanceData.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      exchangeRate: { useQuery: () => ({ data: rateData.current, isLoading: false }) },
      getWithdrawalAddress: {
        useQuery: () => ({ data: withdrawalAddressData.current, isLoading: false }),
      },
    },
  },
}));

describe('DreamsRewardsCard', () => {
  beforeEach(() => {
    signMessageAsync.mockReset();
    walletState.address = ADDRESS as `0x${string}`;
    walletState.isConnected = true;
    balanceData.current = { claimableBaseUnits: '0' };
    rateData.current = undefined;
    withdrawalAddressData.current = { withdrawalAddress: null };
    vi.unstubAllGlobals();
  });

  it('renders nothing when no wallet is connected', () => {
    walletState.address = undefined;
    walletState.isConnected = false;

    const { container } = render(<DreamsRewardsCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the DREAMS hook is not configured (no rate, no claimable)', () => {
    balanceData.current = { claimableBaseUnits: '0' };
    rateData.current = undefined;

    const { container } = render(<DreamsRewardsCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows claimable balance, USD equivalent, and the rate when configured', () => {
    balanceData.current = { claimableBaseUnits: (500n * 10n ** 18n).toString() };
    rateData.current = { dreamsPerUsdc: (10n * 10n ** 18n).toString(), workerSplitBps: 8000 };

    render(<DreamsRewardsCard />);

    expect(screen.getByText('500 DREAMS')).toBeInTheDocument();
    expect(screen.getByText(/50 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/1 USDC = 10 DREAMS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw dreams/i })).toBeEnabled();
  });

  it('disables the withdraw button when claimable balance is zero', () => {
    balanceData.current = { claimableBaseUnits: '0' };
    rateData.current = { dreamsPerUsdc: (10n * 10n ** 18n).toString(), workerSplitBps: 8000 };

    render(<DreamsRewardsCard />);

    expect(screen.getByRole('button', { name: /withdraw dreams/i })).toBeDisabled();
  });

  it('signs and posts a withdrawal, then shows the result', async () => {
    balanceData.current = { claimableBaseUnits: (500n * 10n ** 18n).toString() };
    rateData.current = { dreamsPerUsdc: (10n * 10n ** 18n).toString(), workerSplitBps: 8000 };
    signMessageAsync.mockResolvedValue('0xsignature');
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        txHash: '0xtxhash',
        claimedBaseUnits: (500n * 10n ** 18n).toString(),
      }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<DreamsRewardsCard />);

    const before = Math.floor(Date.now() / 1000);
    await user.click(screen.getByRole('button', { name: /withdraw dreams/i }));
    const after = Math.floor(Date.now() / 1000);

    // The signed message and the request body must carry the same nonce and
    // validBefore -- the backend's WithdrawDreamsInputSchema requires both as
    // non-empty strings and verifies the signature over exactly this message.
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    const signedMessage = signMessageAsync.mock.calls[0][0].message as string;
    const match = signedMessage.match(
      /^taskmarket:withdraw-dreams:(0x[a-fA-F0-9]{40}):(0x[a-fA-F0-9]{64}):(\d+)$/
    );
    expect(match).not.toBeNull();
    const [, signedDestination, signedNonce, signedValidBefore] = match!;
    expect(signedDestination.toLowerCase()).toBe(ADDRESS.toLowerCase());
    // validBefore is ~300s in the future (AUTHORIZATION_VALIDITY_SECONDS).
    expect(Number(signedValidBefore)).toBeGreaterThanOrEqual(before + 300);
    expect(Number(signedValidBefore)).toBeLessThanOrEqual(after + 300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, { body: string }];
    const requestBody = JSON.parse(requestInit.body) as {
      workerAddress: string;
      destination: string;
      nonce: string;
      validBefore: string;
      signature: string;
    };
    expect(requestBody.nonce).toBe(signedNonce);
    expect(requestBody.validBefore).toBe(signedValidBefore);
    expect(requestBody.destination).toBe(ADDRESS);
    expect(requestBody.signature).toBe('0xsignature');

    expect(await screen.findByText(/withdrew 500 dreams/i)).toBeInTheDocument();
  });
});
