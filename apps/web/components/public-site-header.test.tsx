import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PublicSiteHeader } from './public-site-header';

describe('PublicSiteHeader', () => {
  it('links the primary navigation to the dashboard market routes', () => {
    render(<PublicSiteHeader />);

    const primaryNav = screen.getByRole('navigation', { name: /^primary$/i });

    expect(screen.getByRole('link', { name: /taskmarket/i })).toHaveAttribute('href', '/');
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(primaryNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(within(primaryNav).getByRole('link', { name: /^humans$/i })).toHaveAttribute(
      'href',
      '/dashboard/humans'
    );
    expect(within(primaryNav).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/dashboard/protocol'
    );
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute(
      'href',
      '/dashboard'
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
  });
});
