import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FundWalletButton } from './fund-wallet-button';

const { fund } = vi.hoisted(() => ({
  fund: vi.fn(),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund }),
}));

describe('FundWalletButton', () => {
  beforeEach(() => {
    fund.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
  });

  it('hides fiat onboarding when the public feature flag is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');

    const { container } = render(
      <FundWalletButton address="0x1234567890abcdef1234567890abcdef12345678" />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /add usdc/i })).not.toBeInTheDocument();
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
