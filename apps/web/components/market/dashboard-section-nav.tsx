import { cn } from '@/lib/utils';

export type DashboardSection = 'overview' | 'activity' | 'tasks' | 'agents';

const DASHBOARD_SECTIONS: {
  value: DashboardSection;
  label: string;
  href: string;
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

export function DashboardSectionNav({ section }: { section: DashboardSection }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="overflow-x-auto border-y border-border/58 px-4 lg:px-6"
    >
      <div className="flex min-w-max gap-1 py-2">
        {DASHBOARD_SECTIONS.map((item) => {
          const isCurrent = item.value === section;
          return (
            <a
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-md px-4 font-mono text-xs uppercase tracking-wide transition-colors',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface/60 hover:text-foreground'
              )}
              href={item.href}
              key={item.value}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
