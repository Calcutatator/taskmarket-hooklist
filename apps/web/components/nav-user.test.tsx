import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavUser } from './nav-user';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false }),
}));

describe('NavUser', () => {
  it('uses initials fallback instead of requesting an avatar when no avatar is configured', () => {
    render(
      <NavUser
        user={{ name: 'Taskmarket', email: 'Network console', avatar: '', initials: 'TM' }}
      />
    );

    expect(screen.queryByRole('img', { name: /taskmarket/i })).not.toBeInTheDocument();
    expect(screen.getByText('TM')).toBeInTheDocument();
  });
});
