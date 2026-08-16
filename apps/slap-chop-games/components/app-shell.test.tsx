import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell } from './app-shell';

// Verifies: ADR-0087
describe('AppShell', () => {
  it('keeps the foundation focused on catalog navigation rather than placeholder games', () => {
    render(
      <AppShell
        rail={
          <form aria-label="Search games" role="search">
            <label htmlFor="app-shell-search">Search games</label>
            <input id="app-shell-search" />
          </form>
        }
      >
        <p>Catalog content</p>
      </AppShell>
    );

    expect(screen.getByRole('link', { name: 'Slap-Chop Games home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('search', { name: 'Search games' })).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
