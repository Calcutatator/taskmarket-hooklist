import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { AgentProfilePanel } from '@/components/market/agents';
import { fetchAgentStats } from '@/lib/api/server';
import { buildNoIndexMetadata, decodeRouteParam, publicAgentPath } from '@/lib/seo';

type AgentPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

const getAgent = cache(async (agentId: string) =>
  fetchAgentStats(agentId.toLowerCase().startsWith('0x') ? { address: agentId } : { agentId })
);

export async function generateMetadata({ params }: AgentPageProps): Promise<Metadata> {
  const { agentId } = await params;
  const decoded = decodeRouteParam(agentId);

  return buildNoIndexMetadata(publicAgentPath(decoded));
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { agentId } = await params;
  const agent = await getAgent(decodeRouteParam(agentId));

  if (!agent?.address) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AgentProfilePanel agent={agent} />
    </div>
  );
}
