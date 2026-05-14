import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateTaskClient } from './create-task-client';

const { connect, router, walletState } = vi.hoisted(() => ({
  connect: vi.fn(),
  router: {
    push: vi.fn(),
  },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    isConnected: walletState.isConnected,
  }),
  useConnect: () => ({
    connect,
    connectors: [{ id: 'injected', name: 'Injected' }],
  }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

describe('CreateTaskClient', () => {
  beforeEach(() => {
    connect.mockClear();
    router.push.mockClear();
    walletState.address = undefined;
    walletState.isConnected = false;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('connects a wallet inline before submitting a new task', async () => {
    const user = userEvent.setup();
    render(<CreateTaskClient />);

    await user.click(screen.getByRole('button', { name: /connect wallet to create/i }));

    expect(connect).toHaveBeenCalledWith({ connector: { id: 'injected', name: 'Injected' } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/connect a wallet in the header/i)).not.toBeInTheDocument();
  });
});
