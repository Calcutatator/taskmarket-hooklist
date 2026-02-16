import { WagmiProvider } from 'wagmi';
import { ConnectKitProvider } from 'connectkit';
import { ReactNode } from 'react';
import { config } from '@/lib/wagmi';

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <ConnectKitProvider>{children}</ConnectKitProvider>
    </WagmiProvider>
  );
}
