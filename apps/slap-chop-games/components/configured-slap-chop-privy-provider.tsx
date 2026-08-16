'use client';

import { getAccessToken, PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useMemo, type ReactNode } from 'react';

import {
  SLAP_CHOP_PRIVY_CONFIG,
  SlapChopPrivyContext,
  type SlapChopPrivy,
} from '@/components/slap-chop-privy-context';
import { getSlapChopPrivyAppId, getSlapChopPrivyClientId } from '@/lib/privy-config';

function ConfiguredSlapChopPrivyContext({ children }: Readonly<{ children: ReactNode }>) {
  const { authenticated, login, ready } = usePrivy();
  const value = useMemo<SlapChopPrivy>(
    () => ({
      authenticated,
      configured: true,
      getAccessToken,
      login,
      ready,
    }),
    [authenticated, login, ready]
  );

  return <SlapChopPrivyContext.Provider value={value}>{children}</SlapChopPrivyContext.Provider>;
}

// This module is dynamically imported by SlapChopPrivyProvider only after a public app ID is
// present. Anonymous browse/play consequently never initialize the Privy SDK.
export function ConfiguredSlapChopPrivyProvider({ children }: Readonly<{ children: ReactNode }>) {
  const appId = getSlapChopPrivyAppId();

  if (!appId) {
    return children;
  }

  return (
    <PrivyProvider
      appId={appId}
      clientId={getSlapChopPrivyClientId()}
      config={SLAP_CHOP_PRIVY_CONFIG}
    >
      <ConfiguredSlapChopPrivyContext>{children}</ConfiguredSlapChopPrivyContext>
    </PrivyProvider>
  );
}
