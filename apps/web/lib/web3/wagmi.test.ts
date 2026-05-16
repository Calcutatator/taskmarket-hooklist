import { afterEach, describe, expect, it, vi } from 'vitest';
import { base, baseSepolia } from 'viem/chains';

const createConfig = vi.hoisted(() => vi.fn((config) => config));
const http = vi.hoisted(() => vi.fn((url?: string) => ({ transport: 'http', url })));

vi.mock('@privy-io/wagmi', () => ({
  createConfig,
  WagmiProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('wagmi', () => ({
  http,
}));

describe('wagmi connection config', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createConfig.mockClear();
    http.mockClear();
  });

  it('orders the configured chain first and uses configured RPC URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', String(baseSepolia.id));
    vi.stubEnv('NEXT_PUBLIC_BASE_RPC_URL', 'https://base.rpc');
    vi.stubEnv('NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL', 'https://sepolia.rpc');

    const { privyConfig, supportedChains, wagmiConfig } = (await import('./wagmi')) as unknown as {
      privyConfig: {
        appearance: {
          accentColor: string;
          landingHeader: string;
          loginMessage: string;
          logo: {
            key: string | null;
            props: { alt: string; src: string };
            type: string;
          };
          showWalletLoginFirst: boolean;
          theme: string;
          walletChainType: string;
          walletList: string[];
        };
        defaultChain: { id: number };
        embeddedWallets: { ethereum: { createOnLogin: string } };
        loginMethods: string[];
        supportedChains: Array<{ id: number }>;
      };
      supportedChains: Array<{ id: number; rpcUrls: { default: { http: string[] } } }>;
      wagmiConfig: {
        chains: Array<{ id: number }>;
        transports: Record<number, unknown>;
      };
    };

    expect(wagmiConfig.chains.map((chain) => chain.id)).toEqual([baseSepolia.id, base.id]);
    expect(supportedChains[0].rpcUrls.default.http).toEqual(['https://sepolia.rpc']);
    expect(supportedChains[1].rpcUrls.default.http).toEqual(['https://base.rpc']);
    expect(wagmiConfig.transports[base.id]).toEqual({
      transport: 'http',
      url: 'https://base.rpc',
    });
    expect(wagmiConfig.transports[baseSepolia.id]).toEqual({
      transport: 'http',
      url: 'https://sepolia.rpc',
    });
    expect(privyConfig.appearance.accentColor).toBe('#cc667f');
    expect(privyConfig.appearance.landingHeader).toBe('Enter Taskmarket');
    expect(privyConfig.appearance.loginMessage).toBe(
      'Connect a wallet or create one to fund Base USDC tasks.'
    );
    expect(privyConfig.appearance.logo.type).toBe('img');
    expect(privyConfig.appearance.logo.key).toBe('taskmarket-logo');
    expect(privyConfig.appearance.logo.props).toMatchObject({
      alt: 'Taskmarket',
      src: '/taskmarket-final-icon-transparent.svg',
    });
    expect(privyConfig.appearance.showWalletLoginFirst).toBe(false);
    expect(privyConfig.appearance.theme).toBe('#0f0f12');
    expect(privyConfig.appearance.walletChainType).toBe('ethereum-only');
    expect(privyConfig.appearance.walletList).toEqual([
      'detected_ethereum_wallets',
      'base_account',
      'coinbase_wallet',
      'metamask',
      'rainbow',
      'wallet_connect_qr',
    ]);
    expect(privyConfig.defaultChain.id).toBe(baseSepolia.id);
    expect(privyConfig.supportedChains.map((chain) => chain.id)).toEqual([baseSepolia.id, base.id]);
    expect(privyConfig.embeddedWallets.ethereum.createOnLogin).toBe('users-without-wallets');
    expect(privyConfig.loginMethods).toEqual(['email', 'wallet', 'google', 'passkey']);
  });
});
