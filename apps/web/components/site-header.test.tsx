import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from './site-header';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => <button>Toggle Sidebar</button>,
}));

const { connect, disconnect, walletState } = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
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
  useDisconnect: () => ({ disconnect }),
}));

describe('SiteHeader', () => {
  beforeEach(() => {
    connect.mockClear();
    disconnect.mockClear();
    walletState.address = undefined;
    walletState.isConnected = false;
  });

  it('uses Taskmarket shell copy instead of dashboard demo copy', () => {
    render(<SiteHeader />);

    expect(screen.getByRole('heading', { name: /^console$/i })).toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /github/i })).not.toBeInTheDocument();
  });

  it('lets users connect and disconnect a wallet from the header', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SiteHeader />);

    await user.click(screen.getByRole('button', { name: /connect wallet/i }));
    expect(connect).toHaveBeenCalledWith({ connector: { id: 'injected', name: 'Injected' } });

    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    rerender(<SiteHeader />);

    expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalled();
  });
});
