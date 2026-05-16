import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavUser } from './nav-user';

const { connectOrCreateWallet, login, logout, walletState } = vi.hoisted(() => ({
  connectOrCreateWallet: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  walletState: {
    address: undefined as `0x${string}` | undefined,
    authenticated: undefined as boolean | undefined,
    connector: undefined as { name: string } | undefined,
    isConnected: false,
    privyAddress: undefined as `0x${string}` | undefined,
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    connector: walletState.connector,
    isConnected: walletState.isConnected,
  }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund: vi.fn() }),
  usePrivy: () => {
    const authenticated = walletState.authenticated ?? walletState.isConnected;

    return {
      authenticated,
      connectOrCreateWallet,
      login,
      logout,
      ready: true,
      user: authenticated ? { google: { email: 'user@example.com' } } : null,
    };
  },
  useWallets: () => {
    const address = walletState.privyAddress ?? walletState.address;

    return {
      ready: true,
      wallets: address
        ? [
            {
              address,
              walletClientType: 'privy',
            },
          ]
        : [],
    };
  },
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    asChild,
    onSelect,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) =>
    asChild ? (
      <div>{children}</div>
    ) : (
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
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    connectOrCreateWallet.mockClear();
    login.mockClear();
    logout.mockClear();
    walletState.address = undefined;
    walletState.authenticated = undefined;
    walletState.connector = undefined;
    walletState.isConnected = false;
    walletState.privyAddress = undefined;
  });

  it('shows the connected wallet details and logs out from the account menu', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.connector = { name: 'Privy' };
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');

    render(<NavUser />);

    expect(screen.getAllByText('0x1234...5678').length).toBeGreaterThan(0);
    expect(screen.getAllByText('user@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /switch wallet/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalled();
  });

  it('shows an explicit disconnected wallet state without avatar requests', () => {
    render(<NavUser />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByText('Wallet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0);
  });

  it('starts Privy sign in from the disconnected account menu', async () => {
    const user = userEvent.setup();
    render(<NavUser />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(login).toHaveBeenCalled();
    expect(connectOrCreateWallet).not.toHaveBeenCalled();
  });

  it('shows a Privy-authenticated wallet before wagmi reports a connection', () => {
    walletState.authenticated = true;
    walletState.isConnected = false;
    walletState.privyAddress = '0x1234567890abcdef1234567890abcdef12345678';
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');

    render(<NavUser />);

    expect(screen.getAllByText('0x1234...5678').length).toBeGreaterThan(0);
    expect(screen.getAllByText('user@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
