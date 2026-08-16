import type { PrivyClientConfig } from '@privy-io/react-auth';
import { createContext } from 'react';

export type SlapChopPrivy = {
  authenticated: boolean;
  configured: boolean;
  getAccessToken: () => Promise<string | null>;
  login: () => void;
  ready: boolean;
};

export const unavailableSlapChopPrivy: SlapChopPrivy = {
  authenticated: false,
  configured: false,
  getAccessToken: async () => null,
  login: () => undefined,
  ready: true,
};

export const SlapChopPrivyContext = createContext<SlapChopPrivy>(unavailableSlapChopPrivy);

// Implements: ADR-0089. Provider props override dashboard defaults so catalog sign-in never
// presents wallet login or creates an embedded wallet as a side effect of voting.
export const SLAP_CHOP_PRIVY_CONFIG: PrivyClientConfig = {
  appearance: {
    showWalletLoginFirst: false,
    theme: 'dark',
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'off',
    },
    showWalletUIs: false,
    solana: {
      createOnLogin: 'off',
    },
  },
  externalWallets: {
    disableAllExternalWallets: true,
  },
  // These methods must also be enabled in the catalog's Privy application. Wallet is explicitly
  // absent: a vote identifies a Privy user and never authorizes a chain action.
  loginMethods: ['email', 'google', 'passkey'],
};
