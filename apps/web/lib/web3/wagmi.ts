'use client';

import type { PrivyClientConfig } from '@privy-io/react-auth';
import { createConfig } from '@privy-io/wagmi';
import { createElement } from 'react';
import { base, baseSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import { http } from 'wagmi';

import { getPrivyAppId, getPrivyClientId } from '@/lib/privy-config';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? base.id);

function withRpcUrl<TChain extends Chain>(chain: TChain, rpcUrl?: string): TChain {
  if (!rpcUrl) {
    return chain;
  }

  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  };
}

const configuredBase = withRpcUrl(
  base,
  process.env.NEXT_PUBLIC_BASE_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL
);
const configuredBaseSepolia = withRpcUrl(
  baseSepolia,
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL
);

export const primaryChain = chainId === baseSepolia.id ? configuredBaseSepolia : configuredBase;
export const secondaryChain = chainId === baseSepolia.id ? configuredBase : configuredBaseSepolia;
export const supportedChains: [typeof primaryChain, typeof secondaryChain] = [
  primaryChain,
  secondaryChain,
];

export const privyAppId = getPrivyAppId();
export const privyClientId = getPrivyClientId();

export const privyConfig = {
  appearance: {
    accentColor: '#cc667f',
    landingHeader: 'Enter Taskmarket',
    loginMessage: 'Connect a wallet or create one to fund Base USDC tasks.',
    logo: createElement('img', {
      alt: 'Taskmarket',
      key: 'taskmarket-logo',
      src: '/taskmarket-final-icon-transparent.svg',
    }),
    showWalletLoginFirst: false,
    theme: '#0f0f12',
    walletChainType: 'ethereum-only',
    walletList: [
      'detected_ethereum_wallets',
      'base_account',
      'coinbase_wallet',
      'metamask',
      'rainbow',
      'wallet_connect_qr',
    ],
  },
  defaultChain: primaryChain,
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
  loginMethods: ['email', 'wallet', 'google', 'passkey'],
  supportedChains,
} satisfies PrivyClientConfig;

export const wagmiConfig = createConfig({
  chains: supportedChains,
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL),
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL
    ),
  },
});
