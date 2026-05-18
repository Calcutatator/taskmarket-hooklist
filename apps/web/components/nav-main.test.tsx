import { IconDashboard, IconListDetails } from '@tabler/icons-react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavMain } from './nav-main';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a data-next-link="true" href={href}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/tasks',
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

describe('NavMain', () => {
  it('marks the current route active and keeps dashboard exact', () => {
    render(
      <NavMain
        items={[
          { exact: true, icon: IconDashboard, title: 'Dashboard', url: '/dashboard' },
          { icon: IconListDetails, title: 'Tasks', url: '/dashboard/tasks' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: /tasks/i }).parentElement).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByRole('link', { name: /tasks/i })).toHaveAttribute('data-next-link', 'true');
    expect(screen.getByRole('link', { name: /^dashboard$/i }).parentElement).toHaveAttribute(
      'data-active',
      'false'
    );
    expect(screen.queryByRole('link', { name: /quick create/i })).not.toBeInTheDocument();
  });
});
