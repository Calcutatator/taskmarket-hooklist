import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedPrivy = vi.hoisted(() => ({
  providerProps: undefined as
    | {
        appId: string;
        clientId?: string;
        config?: unknown;
      }
    | undefined,
}));

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken: async () => 'privy-token',
  PrivyProvider: ({
    children,
    ...props
  }: {
    appId: string;
    children: ReactNode;
    clientId?: string;
    config?: unknown;
  }) => {
    mockedPrivy.providerProps = props;
    return children;
  },
  usePrivy: () => ({
    authenticated: false,
    login: () => undefined,
    ready: true,
  }),
}));

import {
  SLAP_CHOP_PRIVY_CONFIG,
  SlapChopPrivyProvider,
  useSlapChopPrivy,
} from './slap-chop-privy-provider';

const originalAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const originalClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

function IdentityProbe() {
  const privy = useSlapChopPrivy();

  return <output>{privy.configured ? 'configured' : 'anonymous'}</output>;
}

describe('SlapChopPrivyProvider', () => {
  beforeEach(() => {
    mockedPrivy.providerProps = undefined;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = originalAppId;
    process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = originalClientId;
  });

  it('keeps browse and play anonymous when identity is not configured', () => {
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

    render(
      <SlapChopPrivyProvider>
        <IdentityProbe />
      </SlapChopPrivyProvider>
    );

    expect(screen.getByText('anonymous')).toBeVisible();
    expect(mockedPrivy.providerProps).toBeUndefined();
  });

  it('pins catalog-only identity methods and disables wallet behavior', async () => {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'catalog-app-id';
    process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = 'catalog-client-id';

    render(
      <SlapChopPrivyProvider>
        <IdentityProbe />
      </SlapChopPrivyProvider>
    );

    await waitFor(() => expect(screen.getByText('configured')).toBeVisible());
    expect(mockedPrivy.providerProps).toMatchObject({
      appId: 'catalog-app-id',
      clientId: 'catalog-client-id',
      config: {
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          showWalletUIs: false,
          solana: { createOnLogin: 'off' },
        },
        externalWallets: { disableAllExternalWallets: true },
        loginMethods: ['email', 'google', 'passkey'],
      },
    });
    expect(SLAP_CHOP_PRIVY_CONFIG.loginMethods).not.toContain('wallet');
  });
});
