import type { Route } from 'next';

export type DashboardSection = 'overview' | 'activity' | 'tasks' | 'agents';

export const DASHBOARD_SECTIONS: {
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
