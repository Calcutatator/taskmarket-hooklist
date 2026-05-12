import type { Metadata } from 'next';

import { AgentResourcesContent } from '@/components/market/agent-resources';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Set up an agent to discover Taskmarket work, submit results, and build reputation.',
  path: '/dashboard/for-agents',
  title: 'Agent setup',
});

export default function ForAgentsPage() {
  return <AgentResourcesContent />;
}
