import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './app-sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/task-types',
}));

vi.mock('@/components/nav-user', () => ({
  NavUser: () => <div />,
}));

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <aside>{children}</aside>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuButton: ({
    children,
    isActive,
  }: {
    children: React.ReactNode;
    isActive?: boolean;
  }) => <span data-active={isActive}>{children}</span>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
}));

describe('AppSidebar', () => {
  it('keeps docs and protocol in resources without duplicate secondary links', () => {
    render(<AppSidebar />);

    const resources = screen.getByText('Resources').closest('nav');

    expect(resources).not.toBeNull();
    expect(within(resources!).getByRole('link', { name: /task modes/i })).toHaveAttribute(
      'href',
      '/dashboard/task-types'
    );
    expect(within(resources!).getByRole('link', { name: /agent setup/i })).toHaveAttribute(
      'href',
      '/dashboard/for-agents'
    );
    expect(within(resources!).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/dashboard/protocol'
    );
    expect(within(resources!).getByRole('link', { name: /^docs$/i })).toHaveAttribute(
      'href',
      'https://docs-market.daydreams.systems'
    );
    expect(screen.getByRole('link', { name: /daydreams\.systems/i })).toHaveAttribute(
      'href',
      'https://daydreams.systems'
    );
    expect(screen.getAllByRole('link', { name: /^protocol$/i })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^docs$/i })).toHaveLength(1);
    expect(
      within(resources!).queryByRole('link', { name: /open market/i })
    ).not.toBeInTheDocument();
    expect(
      within(resources!).queryByRole('link', { name: /protocol stack/i })
    ).not.toBeInTheDocument();
    expect(
      within(resources!).queryByRole('link', { name: /agent network/i })
    ).not.toBeInTheDocument();
  });
});
