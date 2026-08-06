'use client';

import Link from 'next/link';

import { tabsListVariants, tabsTriggerVariants } from '@/components/ui/tabs-variants';
import { cn } from '@/lib/utils';

import { DASHBOARD_SECTIONS, type DashboardSection } from './dashboard-section';

export function DashboardSectionTabsClient({ section }: { section: DashboardSection }) {
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
