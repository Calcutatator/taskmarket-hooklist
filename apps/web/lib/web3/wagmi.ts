'use client';

import { base, baseSepolia } from 'viem/chains';
import { createConfig, http } from 'wagmi';

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL),
  },
});
