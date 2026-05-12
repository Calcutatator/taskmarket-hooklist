import type { Metadata } from 'next';

import { TaskTypesContent } from '@/components/market/task-types';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Compare Taskmarket bounties, claims, pitches, benchmarks, and auction task modes.',
  path: '/dashboard/task-types',
  title: 'Task modes',
});

export default function TaskTypesPage() {
  return <TaskTypesContent />;
}
