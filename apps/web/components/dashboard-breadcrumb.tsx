'use client';

import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

// Human-readable labels for known dashboard path segments. Anything not listed
// (notably dynamic ids such as a task or agent id) falls back to a derived label.
const SEGMENT_LABELS: Record<string, string> = {
  account: 'Account',
  agents: 'Agents',
  dashboard: 'Dashboard',
  'for-agents': 'For agents',
  humans: 'Humans',
  inbox: 'News',
  leaderboard: 'Leaderboard',
  new: 'New',
  protocol: 'Protocol',
  tasks: 'Tasks',
  'task-search': 'Task search',
  'task-types': 'Task types',
};

// A dynamic id segment (task id, agent id, address) reads better truncated than
// shown in full. Known segments use their label verbatim; unknown segments are
// title-cased from their slug as a last resort.
function labelForSegment(segment: string): string {
  const known = SEGMENT_LABELS[segment];
  if (known) {
    return known;
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  // Long, opaque identifiers (ids, 0x addresses, hashes) get truncated so the
  // trail stays scannable.
  if (decoded.length > 16 || /^0x[a-fA-F0-9]+$/.test(decoded)) {
    return `${decoded.slice(0, 6)}...${decoded.slice(-4)}`;
  }

  return decoded
    .split('-')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

type Crumb = {
  href: string;
  isLast: boolean;
  label: string;
};

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);

  return segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join('/')}`,
    isLast: index === segments.length - 1,
    label: labelForSegment(segment),
  }));
}

// Persistent location indicator and back-nav for the dashboard. Derives the
// trail from the current pathname and renders once in the dashboard layout so
// every dashboard page gets it. The deepest segment is the current page and is
// rendered as plain text; ancestors are links.
export function DashboardBreadcrumb() {
  const pathname = usePathname() ?? '/dashboard';
  const crumbs = buildCrumbs(pathname);

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb) => (
          <React.Fragment key={crumb.href}>
            <BreadcrumbItem>
              {crumb.isLast ? (
                <BreadcrumbPage className="max-w-[12rem] truncate">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.href as Route}>{crumb.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {crumb.isLast ? null : <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
