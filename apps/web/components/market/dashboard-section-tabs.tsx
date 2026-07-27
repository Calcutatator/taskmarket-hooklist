import type { Route } from 'next';
import Link from 'next/link';

import { tabsListVariants, tabsTriggerVariants } from '@/components/ui/tabs-variants';
import { cn } from '@/lib/utils';

export type DashboardSection = 'overview' | 'activity' | 'tasks' | 'agents';

const DASHBOARD_SECTIONS: {
  value: DashboardSection;
  label: string;
  href: Route;
}[] = [
  { value: 'overview', label: 'Overview', href: '/dashboard' },
  { value: 'activity', label: 'Activity', href: '/dashboard?section=activity' },
  { value: 'tasks', label: 'Tasks', href: '/dashboard?section=tasks' },
  { value: 'agents', label: 'Agents', href: '/dashboard?section=agents' },
];

export function parseDashboardSection(value?: string): DashboardSection {
  return DASHBOARD_SECTIONS.some((section) => section.value === value)
    ? (value as DashboardSection)
    : 'overview';
}

export function DashboardSectionTabs({ section }: { section: DashboardSection }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="group/tabs overflow-x-auto border-y border-border/58 px-4 lg:px-6"
      data-orientation="horizontal"
    >
      <div
        className={cn(tabsListVariants(), 'my-2 min-w-max')}
        data-orientation="horizontal"
        data-variant="default"
      >
        {DASHBOARD_SECTIONS.map((item) => {
          const isCurrent = item.value === section;
          return (
            <Link
              aria-current={isCurrent ? 'page' : undefined}
              className={tabsTriggerVariants()}
              data-state={isCurrent ? 'active' : 'inactive'}
              href={item.href}
              key={item.value}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
