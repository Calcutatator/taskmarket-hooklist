import { IconDatabase } from '@tabler/icons-react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavDocuments } from './nav-documents';

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
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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

describe('NavDocuments', () => {
  it('renders marketplace resources without generated document actions', () => {
    render(
      <NavDocuments
        items={[{ icon: IconDatabase, name: 'Open Market', url: '/dashboard/tasks' }]}
      />
    );

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open market/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(screen.getByRole('link', { name: /open market/i })).toHaveAttribute(
      'data-next-link',
      'true'
    );
    expect(screen.getByRole('link', { name: /open market/i }).parentElement).toHaveAttribute(
      'data-active',
      'false'
    );
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByText('Share')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });
});
