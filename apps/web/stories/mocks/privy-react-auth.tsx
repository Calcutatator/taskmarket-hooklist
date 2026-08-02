import type { ReactNode } from 'react';

export async function getAccessToken() {
  return null;
}

export function PrivyProvider({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

export function useFiatOnramp() {
  return {
    fund: async () => undefined,
  };
}

export function usePrivy() {
  return {
    authenticated: false,
    connectOrCreateWallet: async () => undefined,
    login: async () => undefined,
    logout: async () => undefined,
    ready: true,
    user: null,
  };
}

export function useWallets() {
  return {
    ready: true,
    wallets: [],
  };
}
