import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DashboardSectionNav,
  parseDashboardSection,
  type DashboardSection,
} from './dashboard-section-nav';

describe('parseDashboardSection', () => {
  it.each([
    [undefined, 'overview'],
    ['overview', 'overview'],
    ['activity', 'activity'],
    ['tasks', 'tasks'],
    ['agents', 'agents'],
    ['unknown', 'overview'],
  ] satisfies [string | undefined, DashboardSection][])('maps %s to %s', (value, expected) => {
    expect(parseDashboardSection(value)).toBe(expected);
  });
});

describe('DashboardSectionNav', () => {
  it('links every dashboard section and identifies the current page', () => {
    render(<DashboardSectionNav section="tasks" />);

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute(
      'href',
      '/dashboard?section=activity'
    );
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'href',
      '/dashboard?section=tasks'
    );
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'href',
      '/dashboard?section=agents'
    );
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});
