import { ReactNode } from 'react';
import { QueryProvider } from './QueryProvider';
import { WalletProvider } from './WalletProvider';
import { TRPCProvider } from './TRPCProvider';
import { ThemeProvider } from './ThemeContext';

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WalletProvider>
        <QueryProvider>
          <TRPCProvider>{children}</TRPCProvider>
        </QueryProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
