import { createConfig, http, type CreateConnectorFn } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const connectors: CreateConnectorFn[] = projectId
  ? [injected(), walletConnect({ projectId })]
  : [injected()];

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});
