import { ReactNode } from 'react';
import { QueryProvider } from './QueryProvider';
import { WalletProvider } from './WalletProvider';
import { TRPCProvider } from './TRPCProvider';

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <WalletProvider>
        <TRPCProvider>{children}</TRPCProvider>
      </WalletProvider>
    </QueryProvider>
  );
}
