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
  Sidebar: ({ children, collapsible }: { children: React.ReactNode; collapsible?: string }) => (
    <aside data-collapsible={collapsible}>{children}</aside>
  ),
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <nav className={className}>{children}</nav>
  ),
  SidebarGroupContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
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
  it('uses icon collapse so the desktop sidebar becomes an icon rail', () => {
    render(<AppSidebar />);

    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsible', 'icon');
  });

  it('keeps docs and protocol in resources without duplicate secondary links', () => {
    render(<AppSidebar />);

    const resources = screen.getByText('Resources').closest('nav');

    expect(resources).not.toBeNull();
    expect(resources).not.toHaveClass('group-data-[collapsible=icon]:hidden');
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(screen.getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(screen.getByRole('link', { name: /^leaderboard$/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard'
    );
    expect(within(resources!).getByRole('link', { name: /^news$/i })).toHaveAttribute(
      'href',
      '/dashboard/inbox'
    );
    expect(within(resources!).getByRole('link', { name: /^humans$/i })).toHaveAttribute(
      'href',
      '/dashboard/humans'
    );
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
      'https://docs.taskmarket.dev'
    );
    expect(within(resources!).getByRole('link', { name: /daydreams\.systems/i })).toHaveAttribute(
      'href',
      'https://daydreams.systems'
    );
    expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute(
      'href',
      '/dashboard/account'
    );
    expect(screen.getAllByRole('link', { name: /^protocol$/i })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^docs$/i })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /browse tasks/i })).not.toBeInTheDocument();
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
