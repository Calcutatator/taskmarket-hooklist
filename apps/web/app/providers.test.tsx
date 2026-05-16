import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Providers } from './providers';

vi.mock('@privy-io/react-auth', async () => {
  const { useQueryClient } =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    PrivyProvider: ({ appId, children }: { appId: string; children: React.ReactNode }) => {
      useQueryClient();

      return (
        <div data-app-id={appId} data-provider="privy">
          {children}
        </div>
      );
    },
  };
});

vi.mock('@privy-io/wagmi', () => ({
  WagmiProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-provider="privy-wagmi">{children}</div>
  ),
}));

vi.mock('wagmi', () => ({
  WagmiProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-provider="wagmi">{children}</div>
  ),
}));

vi.mock('@/lib/web3/wagmi', () => ({
  privyAppId: '1234567890123456789012345',
  privyClientId: 'client-id',
  privyConfig: {},
  wagmiConfig: {},
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-provider="toaster" />,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-provider="tooltip">{children}</div>
  ),
}));

describe('Providers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('initializes Privy and Privy wagmi providers when a Privy app id is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '1234567890123456789012345');

    const { container } = render(
      <Providers>
        <span>child</span>
      </Providers>
    );

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(container.querySelector('[data-provider="privy"]')).toHaveAttribute(
      'data-app-id',
      '1234567890123456789012345'
    );
    expect(container.querySelector('[data-provider="privy-wagmi"]')).toBeInTheDocument();
    expect(container.querySelector('[data-provider="tooltip"]')).toBeInTheDocument();
    expect(container.querySelector('[data-provider="wagmi"]')).not.toBeInTheDocument();
  });

  it('does not initialize Privy in local builds without an app id', () => {
    const { container } = render(
      <Providers>
        <span>child</span>
      </Providers>
    );

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(container.querySelector('[data-provider="privy"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-provider="privy-wagmi"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-provider="wagmi"]')).toBeInTheDocument();
  });
});
