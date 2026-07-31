import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(
      within(screen.getByRole('dialog', { name: /menu/i })).getByRole('link', {
        name: /^latest drop$/i,
      })
    ).toHaveAttribute('href', '/dashboard/drops');
    expect(
      within(screen.getByRole('dialog', { name: /menu/i })).getByRole('button', {
        name: /^sign in$/i,
      })
    ).toBeEnabled();
    const accountControlIds = Array.from(
      document.querySelectorAll<HTMLElement>('[id$="wallet-connect"]')
    ).map((element) => element.id);
    expect(new Set(accountControlIds).size).toBe(accountControlIds.length);
  });

  it('gives the mobile menu a polished hierarchy and consistent touch targets', async () => {
    const user = userEvent.setup();
    render(<PublicSiteHeader />);

    await user.click(screen.getByRole('button', { name: /open menu/i }));

    const dialog = screen.getByRole('dialog', { name: /menu/i });
    const mobileNav = within(dialog).getByRole('navigation', { name: /mobile primary/i });
    const latestDrop = within(dialog).getByRole('link', { name: /^latest drop$/i });
    const dashboard = within(dialog).getByRole('link', { name: /^dashboard$/i });
    const taskLink = within(mobileNav).getByRole('link', { name: /^tasks$/i });

    expect(dialog).toHaveClass(
      'w-[calc(100%-0.75rem)]',
      'max-w-sm',
      'overflow-hidden',
      'backdrop-blur-2xl'
    );
    expect(latestDrop).toHaveClass('flex', 'min-h-20', 'rounded-xl');
    expect(latestDrop.querySelector('svg')).not.toBeNull();
    expect(dashboard).toHaveClass('flex', 'min-h-14', 'rounded-xl');
    expect(dashboard.querySelector('svg')).not.toBeNull();
    expect(taskLink).toHaveAttribute('aria-current', 'page');
    expect(taskLink).toHaveClass('border-primary/24', 'bg-primary/10');
    expect(within(dialog).getByText(/browse open work and post briefs/i)).toBeVisible();
    expect(within(dialog).getByText(/a market for completed work/i)).toBeVisible();
    for (const link of within(mobileNav).getAllByRole('link')) {
      expect(link).toHaveClass('flex', 'min-h-14', 'items-center', 'rounded-xl');
      expect(link.querySelector('svg')).not.toBeNull();
    }
  });

  it('restores focus to the mobile menu trigger when the sheet closes', async () => {
    const user = userEvent.setup();
    render(<PublicSiteHeader />);

    const menuTrigger = screen.getByRole('button', { name: /open menu/i });
    await user.click(menuTrigger);
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    await waitFor(() => expect(menuTrigger).toHaveFocus());
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
