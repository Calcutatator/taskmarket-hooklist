import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavUser } from './nav-user';

const { disconnect, walletState } = vi.hoisted(() => ({
  disconnect: vi.fn(),
  walletState: {
    address: undefined as `0x${string}` | undefined,
    connector: undefined as { name: string } | undefined,
    isConnected: false,
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    connector: walletState.connector,
    isConnected: walletState.isConnected,
  }),
  useDisconnect: () => ({ disconnect }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button disabled={disabled} onClick={onSelect} type="button">
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false }),
}));

describe('NavUser', () => {
  beforeEach(() => {
    disconnect.mockClear();
    walletState.address = undefined;
    walletState.connector = undefined;
    walletState.isConnected = false;
  });

  it('shows the connected wallet details and disconnects from the account menu', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.connector = { name: 'Injected' };
    walletState.isConnected = true;

    render(<NavUser />);

    expect(screen.getAllByText('0x1234...5678').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Injected').length).toBeGreaterThan(0);
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    expect(screen.queryByText('Log out')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalled();
  });

  it('shows an explicit disconnected wallet state without avatar requests', () => {
    render(<NavUser />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByText('Wallet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0);
  });
});
