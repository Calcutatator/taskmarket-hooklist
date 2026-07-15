'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { WagmiProvider } from 'wagmi';

import { makeQueryClient, makeTrpcClient, trpc } from '@/lib/api/client';
import { isPrivyConfigured } from '@/lib/privy-config';
import { privyAppId, privyClientId, privyConfig, wagmiConfig } from '@/lib/web3/wagmi';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LegalConsentGate } from '@/components/legal-consent-gate';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());
  const [trpcClient] = useState(() => makeTrpcClient());

  const app = (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </trpc.Provider>
  );

  if (!isPrivyConfigured()) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{app}</WagmiProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider appId={privyAppId} clientId={privyClientId} config={privyConfig}>
        <PrivyWagmiProvider config={wagmiConfig}>
          <LegalConsentGate>{app}</LegalConsentGate>
        </PrivyWagmiProvider>
      </PrivyProvider>
    </QueryClientProvider>
  );
}
