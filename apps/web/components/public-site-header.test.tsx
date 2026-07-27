import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicSiteHeader } from './public-site-header';

const { login, navigation } = vi.hoisted(() => ({
  login: vi.fn(),
  navigation: { pathname: '/tasks' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({
    authenticated: false,
    connectOrCreateWallet: vi.fn(),
    login,
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));

describe('PublicSiteHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.pathname = '/tasks';
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
  });

  it('links the primary navigation to the dashboard market routes', () => {
    render(<PublicSiteHeader />);

    const primaryNav = screen.getByRole('navigation', { name: /^primary$/i });
    const brandLogo = screen.getByRole('link', { name: /taskmarket/i }).firstElementChild;

    expect(screen.getByRole('link', { name: /taskmarket/i })).toHaveAttribute('href', '/');
    expect(brandLogo).toHaveClass('block');
    expect(brandLogo).not.toHaveClass('inline-block');
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(primaryNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(within(primaryNav).getByRole('link', { name: /^humans$/i })).toHaveAttribute(
      'href',
      '/dashboard/humans'
    );
    expect(within(primaryNav).getByRole('link', { name: /^leaderboard$/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard'
    );
    expect(within(primaryNav).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/dashboard/protocol'
    );
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: /^latest drop$/i })).toHaveAttribute(
      'href',
      '/dashboard/drops'
    );
  });

  it('reveals the navigation links from the mobile menu trigger', async () => {
    const user = userEvent.setup();
    render(<PublicSiteHeader />);

    const menuTrigger = screen.getByRole('button', { name: /open menu/i });
    expect(menuTrigger).toBeInTheDocument();

    await user.click(menuTrigger);

    const mobileNav = screen.getByRole('navigation', { name: /mobile primary/i });
    expect(within(mobileNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(within(mobileNav).getByRole('link', { name: /^humans$/i })).toHaveAttribute(
      'href',
      '/dashboard/humans'
    );
    expect(within(mobileNav).getByRole('link', { name: /^latest drop$/i })).toHaveAttribute(
      'href',
      '/dashboard/drops'
    );
    expect(within(mobileNav).getByRole('button', { name: /^sign in$/i })).toBeEnabled();
    const accountControlIds = Array.from(
      document.querySelectorAll<HTMLElement>('[id$="wallet-connect"]')
    ).map((element) => element.id);
    expect(new Set(accountControlIds).size).toBe(accountControlIds.length);
  });

  it('marks a nested public route active in both navigation menus', async () => {
    navigation.pathname = '/agents/42';
    const user = userEvent.setup();
    render(<PublicSiteHeader />);

    expect(
      within(screen.getByRole('navigation', { name: /^primary$/i })).getByRole('link', {
        name: 'Agents',
      })
    ).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: /open menu/i }));

    expect(
      within(screen.getByRole('navigation', { name: /mobile primary/i })).getByRole('link', {
        name: 'Agents',
      })
    ).toHaveAttribute('aria-current', 'page');
  });

  it('lets a visitor start sign-in without leaving the public page', async () => {
    const user = userEvent.setup();
    render(<PublicSiteHeader />);

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(login).toHaveBeenCalledTimes(1);
  });
});
