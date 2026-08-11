import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardBreadcrumb } from './dashboard-breadcrumb';

const { routeState } = vi.hoisted(() => ({
  routeState: { pathname: '/dashboard/drops' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
}));

describe('DashboardBreadcrumb', () => {
  it('uses the product name for the Task Drops directory', () => {
    render(<DashboardBreadcrumb />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Task Drops')).toHaveAttribute('aria-current', 'page');
  });

  it('names the primary action workspace Inbox', () => {
    routeState.pathname = '/dashboard/inbox';

    render(<DashboardBreadcrumb />);

    expect(screen.getByText('Inbox')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('News')).not.toBeInTheDocument();
  });
});
