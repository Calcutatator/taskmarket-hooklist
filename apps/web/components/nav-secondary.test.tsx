import { IconSearch, IconSettings } from '@tabler/icons-react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavSecondary } from './nav-secondary';

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

describe('NavSecondary', () => {
  it('allows duplicate shortcut links without stealing active route state', () => {
    render(
      <NavSecondary
        items={[
          { icon: IconSettings, title: 'Protocol', url: '/dashboard/protocol' },
          { active: false, icon: IconSearch, title: 'Task search', url: '/dashboard/tasks' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: /task search/i }).parentElement).toHaveAttribute(
      'data-active',
      'false'
    );
  });
});
