'use client';

import { useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react';

import {
  SlapChopPrivyContext,
  unavailableSlapChopPrivy,
  type SlapChopPrivy,
} from '@/components/slap-chop-privy-context';
import { isSlapChopPrivyConfigured } from '@/lib/privy-config';

type ConfiguredProvider = ComponentType<Readonly<{ children: ReactNode }>>;

export type { SlapChopPrivy } from '@/components/slap-chop-privy-context';
export { SLAP_CHOP_PRIVY_CONFIG } from '@/components/slap-chop-privy-context';

// Implements: ADR-0089. The Privy SDK is loaded only for an explicitly configured catalog;
// anonymous browse and play retain no identity-provider dependency or hydration boundary.
export function SlapChopPrivyProvider({ children }: Readonly<{ children: ReactNode }>) {
  const configured = isSlapChopPrivyConfigured();
  const [ConfiguredProvider, setConfiguredProvider] = useState<ConfiguredProvider | null>(null);

  useEffect(() => {
    let active = true;

    if (!configured) {
      setConfiguredProvider(null);
      return () => {
        active = false;
      };
    }

    void import('@/components/configured-slap-chop-privy-provider')
      .then(({ ConfiguredSlapChopPrivyProvider }) => {
        if (active) {
          setConfiguredProvider(() => ConfiguredSlapChopPrivyProvider);
        }
      })
      .catch(() => {
        // Preserve anonymous catalogue access when the optional identity SDK cannot load.
      });

    return () => {
      active = false;
    };
  }, [configured]);

  if (!configured || !ConfiguredProvider) {
    return (
      <SlapChopPrivyContext.Provider value={unavailableSlapChopPrivy}>
        {children}
      </SlapChopPrivyContext.Provider>
    );
  }

  return <ConfiguredProvider>{children}</ConfiguredProvider>;
}

export function useSlapChopPrivy(): SlapChopPrivy {
  return useContext(SlapChopPrivyContext);
}
