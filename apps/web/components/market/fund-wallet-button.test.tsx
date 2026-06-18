import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FundingGuard, FundWalletButton } from './fund-wallet-button';

const { fund, walletState } = vi.hoisted(() => ({
  fund: vi.fn(),
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    isConnected: walletState.isConnected,
  }),
}));

describe('FundWalletButton', () => {
  beforeEach(() => {
    fund.mockReset();
    walletState.address = undefined;
    walletState.isConnected = false;
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
  });

  it('shows a how-to-fund fallback when the fiat onboarding flag is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');

    render(<FundWalletButton address="0x1234567890abcdef1234567890abcdef12345678" />);

    expect(screen.queryByRole('button', { name: /add usdc/i })).not.toBeInTheDocument();
    expect(screen.getByText(/send usdc on base to this address/i)).toBeInTheDocument();
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('falls back to the connected wagmi address when no address prop is provided', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');
    walletState.address = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca';
    walletState.isConnected = true;

    render(<FundWalletButton />);

    expect(screen.getByText('0xabcabcabcabcabcabcabcabcabcabcabcabcabca')).toBeInTheDocument();
  });

  it('renders nothing in the fallback when there is no wallet address', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');

    const { container } = render(<FundWalletButton />);

    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces the how-to-fund fallback inside FundingGuard when the flag is off', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');

    render(
      <FundingGuard
        address="0x1234567890abcdef1234567890abcdef12345678"
        message="Add funds before signing."
      />
    );

    expect(screen.getByText('Add funds before signing.')).toBeInTheDocument();
    expect(screen.getByText(/send usdc on base to this address/i)).toBeInTheDocument();
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
  });

  it('hides the on-ramp label below xl while keeping it for screen readers', () => {
    render(<FundWalletButton address="0x1234567890abcdef1234567890abcdef12345678" />);

    const label = screen.getByText('Add USDC');
    expect(label).toHaveClass('hidden', 'xl:inline');
  });

  it('starts a Privy fiat onramp flow for Base USDC', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    fund.mockResolvedValueOnce({ status: 'confirmed' });
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '8453');
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FUNDING_ENV', 'production');

    render(
      <FundWalletButton
        address="0x1234567890abcdef1234567890abcdef12345678"
        defaultAmount="50"
        onStatus={onStatus}
      />
    );

    await user.click(screen.getByRole('button', { name: /add usdc/i }));

    expect(fund).toHaveBeenCalledWith({
      defaultAmount: '50',
      destination: {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        asset: 'usdc',
        chain: 'eip155:8453',
      },
      environment: 'production',
      source: {
        assets: ['usd', 'eur', 'gbp'],
        defaultAsset: 'usd',
      },
    });
    expect(onStatus).toHaveBeenCalledWith('confirmed');
  });

  it('surfaces submitted onramp state and keeps the destination on Base Sepolia in testnet mode', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    fund.mockResolvedValueOnce({ status: 'submitted' });
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '84532');

    render(
      <FundWalletButton
        address="0x1234567890abcdef1234567890abcdef12345678"
        defaultAmount="10"
        onStatus={onStatus}
      />
    );

    await user.click(screen.getByRole('button', { name: /add usdc/i }));

    expect(fund).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: expect.objectContaining({ chain: 'eip155:84532' }),
        environment: 'sandbox',
      })
    );
    expect(onStatus).toHaveBeenCalledWith('submitted');
    expect(screen.getByText(/purchase submitted/i)).toBeInTheDocument();
  });

  it('does not show an error when the funding modal is dismissed', async () => {
    const user = userEvent.setup();
    fund.mockRejectedValueOnce(new Error('User closed the funding modal'));

    render(<FundWalletButton address="0x1234567890abcdef1234567890abcdef12345678" />);

    await user.click(screen.getByRole('button', { name: /add usdc/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/funding could not start/i)).not.toBeInTheDocument();
  });

  it('still shows an error when funding fails before the modal can start', async () => {
    const user = userEvent.setup();
    fund.mockRejectedValueOnce(new Error('Provider unavailable'));

    render(<FundWalletButton address="0x1234567890abcdef1234567890abcdef12345678" />);

    await user.click(screen.getByRole('button', { name: /add usdc/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/funding could not start/i);
  });
});
