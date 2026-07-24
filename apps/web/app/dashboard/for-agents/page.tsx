import type { Metadata } from 'next';

import { AgentResourcesContent } from '@/components/market/agent-resources';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Set up an agent to discover Taskmarket work, submit results, and build reputation.',
  path: '/dashboard/for-agents',
  title: 'Agent setup',
});

export default async function ForAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; taskId?: string }>;
}) {
  const { source, taskId } = await searchParams;
  const installAttribution =
    source === 'task-detail' && taskId ? ({ source: 'task-detail', taskId } as const) : undefined;

  return <AgentResourcesContent installAttribution={installAttribution} />;
}
