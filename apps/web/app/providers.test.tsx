import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Providers } from './providers';

vi.mock('@privy-io/react-auth', async () => {
  const { useQueryClient } =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    getAccessToken: vi.fn().mockResolvedValue(null),
    PrivyProvider: ({ appId, children }: { appId: string; children: React.ReactNode }) => {
      useQueryClient();

      return (
        <div data-app-id={appId} data-provider="privy">
          {children}
        </div>
      );
    },
    usePrivy: () => ({ authenticated: false, logout: vi.fn(), ready: true }),
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

const backendBundle = {
  acceptanceAvailable: true,
  acceptanceStatement: 'I agree to the policies.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: `sha256:${'b'.repeat(64)}`,
      slug: 'terms',
      summary: 'Marketplace terms.',
      title: 'Terms of Service',
      type: 'terms_of_service',
      url: 'https://api.taskmarket.example/legal/terms',
      version: '2026-07-1',
    },
  ],
  effectiveAt: '2026-07-15T00:00:00.000Z',
  enforcementEnabled: true,
  privyAppId: '1234567890123456789012345',
  publishedAt: '2026-07-01T00:00:00.000Z',
  status: 'approved',
  version: '2026-07-1',
};

describe('Providers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => backendBundle,
      })
    );
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
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '');

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

  it('surfaces an enforced legal configuration when the web Privy app id is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '');

    render(
      <Providers>
        <span>public market</span>
      </Providers>
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign-in configuration unavailable' })
    ).toBeInTheDocument();
    expect(screen.getByText('public market')).toBeInTheDocument();
  });

  it('surfaces an enforced legal configuration when the web and backend Privy app ids differ', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '1234567890123456789012345');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...backendBundle,
        privyAppId: 'different-server-privy-app-id',
      }),
    } as Response);

    render(
      <Providers>
        <span>public market</span>
      </Providers>
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign-in configuration unavailable' })
    ).toBeInTheDocument();
    expect(screen.getByText('public market')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
