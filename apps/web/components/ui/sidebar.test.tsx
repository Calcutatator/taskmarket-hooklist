import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';

function setupMatchMedia() {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1024,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

describe('Sidebar desktop collapse', () => {
  beforeEach(() => {
    setupMatchMedia();
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
