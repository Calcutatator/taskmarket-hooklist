import { Link, useRouterState } from '@tanstack/react-router';
import { ListTodo, BarChart2, Sun, Moon, Wallet } from 'lucide-react';
import { useAccount, useDisconnect } from 'wagmi';
import { cn } from '@/lib/utils';
import { DaydreamsLogo } from '@/components/ui/DaydreamsLogo';
import { useSidebar } from '@/contexts/SidebarContext';
import { useTheme } from '@/contexts/ThemeContext';

type NavItem = {
  label: string;
  to: string;
};

type NavSection = {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Tasks',
    icon: ListTodo,
    items: [
      { label: 'Browse Tasks', to: '/' },
      { label: 'Create Task', to: '/tasks/new' },
    ],
  },
  {
    label: 'Analytics',
    icon: BarChart2,
    items: [{ label: 'Rankings', to: '/leaderboard' }],
  },
];

interface SidebarContentProps {
  collapsed: boolean;
  onClose?: () => void;
}

function SidebarContent({ collapsed, onClose }: SidebarContentProps) {
  const { location } = useRouterState();
  const { isDark, toggleTheme } = useTheme();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div
        className={cn(
          'flex items-center h-12 shrink-0',
          collapsed ? 'justify-center' : 'px-4 gap-3'
        )}
      >
        <DaydreamsLogo size={collapsed ? 24 : 32} className="text-sidebar-item-active shrink-0" />
        {!collapsed && (
          <span className="font-bold text-base text-text-primary truncate">Taskmarket</span>
        )}
      </div>
      {/* Nav */}
      <nav className="flex-1 overflow-y-auto pt-2 pb-4">
        {NAV_SECTIONS.map((section, index) => {
          const sectionActive = section.items.some((item) => item.to === location.pathname);
          return (
            <div key={section.label} className="pb-2">
              {index > 0 && !collapsed && (
                <div className="mx-4 mt-2 mb-4 border-t border-sidebar-border" />
              )}
              {collapsed ? (
                <Link
                  to={section.items[0].to}
                  title={section.label}
                  onClick={onClose}
                  className={cn(
                    'flex items-center justify-center h-10 w-full transition-colors hover:bg-sidebar-item-hover hover:text-text-primary',
                    sectionActive ? 'text-sidebar-item-active' : 'text-sidebar-item-text'
                  )}
                >
                  <section.icon size={18} />
                </Link>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-4 mb-1">
                    <section.icon size={12} className="text-sidebar-section-text shrink-0" />
                    <span className="text-sm font-semibold uppercase tracking-wider text-sidebar-section-text">
                      {section.label}
                    </span>
                  </div>
                  {section.items.map((item) => {
                    const active = location.pathname === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={onClose}
                        className={cn(
                          'flex items-center pl-12 pr-4 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'text-sidebar-item-active'
                            : 'text-sidebar-item-text hover:bg-sidebar-item-hover hover:text-text-primary'
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          'border-t border-sidebar-border py-3 shrink-0',
          collapsed ? 'flex flex-col items-center gap-2' : 'px-4 space-y-2'
        )}
      >
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className={cn(
            'rounded-md p-2 text-sidebar-item-text hover:bg-sidebar-item-hover hover:text-text-primary transition-colors',
            !collapsed && 'w-full flex items-center gap-2'
          )}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && <span className="text-sm">{isDark ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        {isConnected && address && (
          <>
            {collapsed ? (
              <div title={address} className="rounded-md p-2 text-sidebar-item-text cursor-default">
                <Wallet size={16} />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-sidebar-item-text font-mono truncate" title={address}>
                  {address.slice(0, 6)}...{address.slice(-4)}
                </div>
                <button
                  onClick={() => disconnect()}
                  className="text-xs text-sidebar-item-text hover:text-text-primary transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { state, mobileOpen, closeMobile } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col bg-sidebar-bg border-r border-sidebar-border transition-all duration-200 ease-in-out shrink-0 relative',
          collapsed ? 'w-12' : 'w-64'
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile overlay */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-50 transition-opacity duration-200',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="absolute inset-0 bg-black/50" onClick={closeMobile} />
        <aside
          className={cn(
            'absolute left-0 top-0 bottom-0 w-72 bg-sidebar-bg border-r border-sidebar-border flex flex-col transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarContent collapsed={false} onClose={closeMobile} />
        </aside>
      </div>
    </>
  );
}
