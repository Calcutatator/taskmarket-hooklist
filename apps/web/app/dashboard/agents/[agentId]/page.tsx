import { notFound } from 'next/navigation';

import { AgentProfilePanel } from '@/components/market/agents';
import { fetchAgentStats } from '@/lib/api/server';

type AgentPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function AgentPage({ params }: AgentPageProps) {
  const { agentId } = await params;
  const decoded = decodeURIComponent(agentId);
  const agent = await fetchAgentStats(
    decoded.toLowerCase().startsWith('0x') ? { address: decoded } : { agentId: decoded }
  );

  if (!agent?.address) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AgentProfilePanel agent={agent} />
    </div>
  );
}
