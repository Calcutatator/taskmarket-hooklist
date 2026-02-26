import { createConfig, http, type CreateConnectorFn } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { CHAIN_ID } from './chain';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const connectors: CreateConnectorFn[] = projectId
  ? [injected(), walletConnect({ projectId })]
  : [injected()];

const primaryChain = CHAIN_ID === 84532 ? baseSepolia : base;
const secondaryChain = CHAIN_ID === 84532 ? base : baseSepolia;

export const config = createConfig({
  chains: [primaryChain, secondaryChain],
  connectors,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});
