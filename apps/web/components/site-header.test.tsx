import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from './site-header';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => <button>Toggle Sidebar</button>,
}));

const { connect, disconnect, routeState, walletState } = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  routeState: {
    pathname: '/dashboard',
  },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
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
    routeState.pathname = '/dashboard';
    walletState.address = undefined;
    walletState.isConnected = false;
  });

  it('uses a route-aware Taskmarket shell title instead of dashboard demo copy', () => {
    render(<SiteHeader />);

    expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^console$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /github/i })).not.toBeInTheDocument();
  });

  it('names task routes by the active user flow', () => {
    const { rerender } = render(<SiteHeader />);

    routeState.pathname = '/dashboard/tasks';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^open tasks$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/tasks/new';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^fund a task$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/tasks/0xabc123';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^task detail$/i })).toBeInTheDocument();
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
