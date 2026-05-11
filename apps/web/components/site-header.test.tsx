import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiteHeader } from './site-header';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => <button>Toggle Sidebar</button>,
}));

describe('SiteHeader', () => {
  it('uses Taskmarket shell copy instead of dashboard demo copy', () => {
    render(<SiteHeader />);

    expect(screen.getByRole('heading', { name: /taskmarket console/i })).toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /github/i })).not.toBeInTheDocument();
  });
});
