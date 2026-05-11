'use client';

import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, type CreateConnectorFn } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? base.id);
const primaryChain = chainId === baseSepolia.id ? baseSepolia : base;
const secondaryChain = chainId === baseSepolia.id ? base : baseSepolia;
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const connectors: CreateConnectorFn[] = walletConnectProjectId
  ? [injected(), walletConnect({ projectId: walletConnectProjectId })]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [primaryChain, secondaryChain],
  connectors,
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL),
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL
    ),
  },
});
