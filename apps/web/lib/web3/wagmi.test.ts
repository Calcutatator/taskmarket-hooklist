import { afterEach, describe, expect, it, vi } from 'vitest';
import { base, baseSepolia } from 'viem/chains';

const createConfig = vi.hoisted(() => vi.fn((config) => config));
const http = vi.hoisted(() => vi.fn((url?: string) => ({ transport: 'http', url })));
const injected = vi.hoisted(() => vi.fn(() => ({ id: 'injected' })));
const walletConnect = vi.hoisted(() =>
  vi.fn((options: { projectId: string }) => ({ id: 'walletConnect', options }))
);

vi.mock('wagmi', () => ({
  createConfig,
  http,
}));

vi.mock('wagmi/connectors', () => ({
  injected,
  walletConnect,
}));

describe('wagmi connection config', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createConfig.mockClear();
    http.mockClear();
    injected.mockClear();
    walletConnect.mockClear();
  });

  it('orders the configured chain first and includes injected plus WalletConnect when configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', String(baseSepolia.id));
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'project-123');
    vi.stubEnv('NEXT_PUBLIC_BASE_RPC_URL', 'https://base.rpc');
    vi.stubEnv('NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL', 'https://sepolia.rpc');

    const { wagmiConfig } = (await import('./wagmi')) as unknown as {
      wagmiConfig: {
        chains: unknown[];
        connectors: unknown[];
        transports: Record<number, unknown>;
      };
    };

    expect(wagmiConfig.chains).toEqual([baseSepolia, base]);
    expect(wagmiConfig.connectors).toEqual([
      { id: 'injected' },
      { id: 'walletConnect', options: { projectId: 'project-123' } },
    ]);
    expect(wagmiConfig.transports[base.id]).toEqual({
      transport: 'http',
      url: 'https://base.rpc',
    });
    expect(wagmiConfig.transports[baseSepolia.id]).toEqual({
      transport: 'http',
      url: 'https://sepolia.rpc',
    });
  });
});
