import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';

const routeState = vi.hoisted(() => ({
  pathname: '/dashboard',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
}));

function setupMatchMedia(width = 1024) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: width < 768,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

describe('Sidebar desktop collapse', () => {
  beforeEach(() => {
    setupMatchMedia();
    routeState.pathname = '/dashboard';
    window.localStorage.clear();
  });

  it('toggles desktop sidebars to an icon rail instead of off-canvas', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <div>Navigation</div>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    const trigger = screen.getByRole('button', { name: /toggle sidebar/i });

    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);

    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
    expect(sidebar).not.toHaveAttribute('data-collapsible', 'offcanvas');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem('sidebar_state')).toBe('false');
  });

  it('restores the locally saved desktop collapsed preference', () => {
    window.localStorage.setItem('sidebar_state', 'false');

    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <div>Navigation</div>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');

    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('does not expand the icon rail when the rail surface is clicked', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('sidebar_state', 'false');

    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <div>Navigation</div>
          <SidebarRail />
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    const rail = container.querySelector('[data-slot="sidebar-rail"]');

    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    expect(rail).not.toHaveAttribute('aria-label', 'Toggle Sidebar');

    await user.click(rail!);

    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('does not expand from the global sidebar keyboard shortcut', () => {
    window.localStorage.setItem('sidebar_state', 'false');

    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <div>Navigation</div>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));

    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  });
});

describe('Sidebar mobile navigation', () => {
  beforeEach(() => {
    setupMatchMedia(375);
    routeState.pathname = '/dashboard';
    window.localStorage.clear();
  });

  it('opens with accessible 44px controls, closes explicitly, and closes after navigation', async () => {
    const user = userEvent.setup();
    const renderShell = () => (
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <a href="/dashboard/tasks">Tasks</a>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );
    const { rerender } = render(renderShell());
    const trigger = screen.getByRole('button', { name: /toggle sidebar/i });

    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(trigger).toHaveClass('size-11');

    await user.click(trigger);

    const close = await screen.findByRole('button', { name: /^close$/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(close).toHaveClass('size-11');

    await user.click(close);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument()
    );

    await user.click(trigger);
    expect(await screen.findByRole('button', { name: /^close$/i })).toBeInTheDocument();

    routeState.pathname = '/dashboard/tasks';
    rerender(renderShell());

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument()
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
