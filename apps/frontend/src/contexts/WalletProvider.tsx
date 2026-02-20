import { WagmiProvider } from 'wagmi';
import { ReactNode } from 'react';
import { config } from '@/lib/wagmi';

export function WalletProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
