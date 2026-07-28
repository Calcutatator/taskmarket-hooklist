import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardConsoleLoading } from './dashboard-loading';

describe('DashboardConsoleLoading', () => {
  it('reserves the console chrome the page keeps across every section', () => {
    const { container } = render(<DashboardConsoleLoading />);

    expect(screen.getByRole('status', { name: 'Loading dashboard' })).toBeInTheDocument();
    // The scope heading and the section tabs are painted on every ?section=
    // navigation, so the fallback has to hold their space.
    expect(container.querySelector('[data-testid="dashboard-scope-skeleton"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="dashboard-section-tabs-skeleton"]')
    ).not.toBeNull();
  });

  it('does not stand a table in for a section that renders cards', () => {
    const { container } = render(<DashboardConsoleLoading />);

    expect(container.querySelector('[data-testid="table-skeleton"]')).toBeNull();
  });

  it('renders one metric slot per console KPI', () => {
    const { container } = render(<DashboardConsoleLoading metricCount={5} />);

    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(5);
  });
});
