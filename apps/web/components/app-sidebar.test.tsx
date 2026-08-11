import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './app-sidebar';

const { actionQueueState } = vi.hoisted(() => ({
  actionQueueState: { total: 4 },
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    isConnected: true,
  }),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useActionQueue: () => ({
    data: { items: [], total: actionQueueState.total, urgentTotal: 0, waiting: [] },
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/task-types',
}));

vi.mock('@/components/nav-user', () => ({
  NavUser: () => <div />,
}));

vi.mock('@/components/market/first-run-checklist', () => ({
  FirstRunChecklist: () => <section aria-label="First run onboarding" />,
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
  SidebarMenuBadge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
}));

describe('AppSidebar', () => {
  it('uses icon collapse so the desktop sidebar becomes an icon rail', () => {
    render(<AppSidebar />);

    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsible', 'icon');
  });

  it('keeps first-run onboarding and resources in the sidebar', () => {
    render(<AppSidebar />);

    const resources = screen.getByText('Resources').closest('nav');

    expect(resources).not.toBeNull();
    expect(resources).not.toHaveClass('group-data-[collapsible=icon]:hidden');
    expect(screen.getByRole('region', { name: /first run onboarding/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(screen.getByRole('link', { name: /inbox, 4 actions to do/i })).toHaveAttribute(
      'href',
      '/dashboard/inbox'
    );
    expect(screen.getByRole('link', { name: /^task drops$/i })).toHaveAttribute(
      'href',
      '/dashboard/drops'
    );
    expect(screen.getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(screen.getByRole('link', { name: /^leaderboard$/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard'
    );
    expect(within(resources!).queryByRole('link', { name: /^news$/i })).not.toBeInTheDocument();
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
    const primaryLinks = screen
      .getAllByRole('link')
      .filter((link) =>
        ['/dashboard/tasks', '/dashboard/inbox', '/dashboard/drops', '/dashboard/agents'].includes(
          link.getAttribute('href') ?? ''
        )
      );
    expect(primaryLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard/tasks',
      '/dashboard/inbox',
      '/dashboard/drops',
      '/dashboard/agents',
    ]);
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
