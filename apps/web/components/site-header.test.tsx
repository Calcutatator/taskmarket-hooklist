import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from './site-header';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => <button>Toggle Sidebar</button>,
}));

const { connectOrCreateWallet, login, logout, routeState, walletState } = vi.hoisted(() => ({
  connectOrCreateWallet: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  routeState: {
    pathname: '/dashboard',
  },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    authenticated: undefined as boolean | undefined,
    isConnected: false,
    privyAddress: undefined as `0x${string}` | undefined,
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
      user: authenticated ? { email: { address: 'user@example.com' } } : null,
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

describe('SiteHeader', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    connectOrCreateWallet.mockClear();
    login.mockClear();
    logout.mockClear();
    routeState.pathname = '/dashboard';
    walletState.address = undefined;
    walletState.authenticated = undefined;
    walletState.isConnected = false;
    walletState.privyAddress = undefined;
  });

  it('uses a route-aware Taskmarket shell title instead of dashboard demo copy', () => {
    render(<SiteHeader />);

    expect(screen.getByRole('banner')).toHaveClass('border-b', 'bg-background/72');
    expect(screen.getByRole('banner')).not.toHaveClass(
      'rounded-t-xl',
      'shadow-[var(--shadow-soft)]'
    );
    expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^console$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /github/i })).not.toBeInTheDocument();
  });

  it('standardizes the primary create-task CTA and renames the skill link', () => {
    render(<SiteHeader />);

    expect(screen.getByRole('link', { name: /^post a task$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.queryByRole('link', { name: /^post task$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /agent skill file/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
    expect(screen.queryByRole('link', { name: /^skill\.md$/i })).not.toBeInTheDocument();
  });

  it('hides the top-bar Post a task CTA on routes that carry their own', () => {
    const { rerender } = render(<SiteHeader />);
    expect(screen.getByRole('link', { name: /^post a task$/i })).toBeInTheDocument();

    // The task list page renders its own primary CTA next to the heading.
    routeState.pathname = '/dashboard/tasks';
    rerender(<SiteHeader />);
    expect(screen.queryByRole('link', { name: /^post a task$/i })).not.toBeInTheDocument();

    // The create form IS the post flow.
    routeState.pathname = '/dashboard/tasks/new';
    rerender(<SiteHeader />);
    expect(screen.queryByRole('link', { name: /^post a task$/i })).not.toBeInTheDocument();

    // Other routes keep the global CTA.
    routeState.pathname = '/dashboard/agents';
    rerender(<SiteHeader />);
    expect(screen.getByRole('link', { name: /^post a task$/i })).toBeInTheDocument();
  });

  it('names task routes by the active user flow', () => {
    const { rerender } = render(<SiteHeader />);

    routeState.pathname = '/dashboard/tasks';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^open tasks$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/tasks/new';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^post a task$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/tasks/0xabc123';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^task detail$/i })).toBeInTheDocument();
  });

  it('names Task Drop directory and detail routes', () => {
    const { rerender } = render(<SiteHeader />);

    routeState.pathname = '/dashboard/drops';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^Task Drops$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/drops/drop-1';
    rerender(<SiteHeader />);
    expect(screen.getByRole('heading', { name: /^Task Drop detail$/i })).toBeInTheDocument();
  });

  it('lets users sign in and log out with Privy from the header', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SiteHeader />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(login).toHaveBeenCalled();
    expect(connectOrCreateWallet).not.toHaveBeenCalled();

    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    rerender(<SiteHeader />);

    await user.click(screen.getByRole('button', { name: /wallet 0x1234\.\.\.5678/i }));
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /switch wallet/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalled();
  });

  it('treats an authenticated Privy wallet as signed in before wagmi connects', async () => {
    const user = userEvent.setup();

    walletState.authenticated = true;
    walletState.isConnected = false;
    walletState.privyAddress = '0x1234567890abcdef1234567890abcdef12345678';
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');

    render(<SiteHeader />);

    await user.click(screen.getByRole('button', { name: /wallet 0x1234\.\.\.5678/i }));
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
  });
});
