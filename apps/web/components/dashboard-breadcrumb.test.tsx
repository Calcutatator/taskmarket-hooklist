import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardBreadcrumb } from './dashboard-breadcrumb';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/drops',
}));

describe('DashboardBreadcrumb', () => {
  it('uses the product name for the Task Drops directory', () => {
    render(<DashboardBreadcrumb />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Task Drops')).toHaveAttribute('aria-current', 'page');
  });
});
