import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCachedReadAuthHeaders,
  getCachedReadAuthHeaders,
  setCachedReadAuthHeaders,
} from '@/lib/read-auth';
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
    ready: true,
    walletsReady: true,
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
      ready: walletState.ready,
      user: authenticated ? { google: { email: 'user@example.com' } } : null,
    };
  },
  useWallets: () => {
    const address = walletState.privyAddress ?? walletState.address;

    return {
      ready: walletState.walletsReady,
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
    walletState.ready = true;
    walletState.walletsReady = true;
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearCachedReadAuthHeaders();
  });

  it('clears the previous wallet proof before switching wallets', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    setCachedReadAuthHeaders(walletState.address, {
      'X-Taskmarket-Caller-Address': walletState.address,
      'X-Taskmarket-Caller-Signature': '0xproof',
    });

    render(<NavUser />);
    await user.click(screen.getByRole('button', { name: /switch wallet/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(getCachedReadAuthHeaders()).toEqual({});
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

    window.localStorage.setItem('taskmarket:legal-receipt', 'receipt-1');
    window.sessionStorage.setItem('taskmarket:task-access:private-task', 'grant-1');
    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalled();
    expect(window.localStorage.getItem('taskmarket:legal-receipt')).toBeNull();
    expect(window.sessionStorage.getItem('taskmarket:task-access:private-task')).toBeNull();
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

  it('offers wallet creation to an authenticated user without a wallet', async () => {
    const user = userEvent.setup();
    walletState.authenticated = true;

    render(<NavUser />);

    await user.click(screen.getByRole('button', { name: /^connect wallet$/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it('offers recovery when authenticated wallets stop hydrating', async () => {
    vi.useFakeTimers();
    walletState.authenticated = true;
    walletState.walletsReady = false;

    render(<NavUser />);

    expect(screen.getByRole('button', { name: /^loading wallet$/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^connect wallet$/i })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(8000));

    expect(screen.getByRole('button', { name: /^retry wallet$/i })).toBeEnabled();
    vi.useRealTimers();
  });

  it('offers recovery when Privy readiness times out', async () => {
    vi.useFakeTimers();
    walletState.ready = false;

    render(<NavUser />);

    expect(screen.getByRole('button', { name: /^loading$/i })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(8000));

    expect(screen.getByRole('button', { name: /^retry sign in$/i })).toBeEnabled();
    vi.useRealTimers();
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
