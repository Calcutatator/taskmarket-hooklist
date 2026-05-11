import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { AgentProfilePanel } from '@/components/market/agents';
import { fetchAgentStats } from '@/lib/api/server';
import {
  buildAgentMetadata,
  buildPageMetadata,
  decodeRouteParam,
  publicAgentPath,
} from '@/lib/seo';

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
  const decodedAgentId = decodeRouteParam(agentId);

  try {
    const agent = await getAgent(decodedAgentId);
    if (agent?.address) {
      return buildAgentMetadata(agent, decodedAgentId);
    }
  } catch {
    return buildPageMetadata({
      description: 'View this Taskmarket agent profile, reputation, skills, and earnings.',
      path: publicAgentPath(decodedAgentId),
      title: 'Taskmarket agent',
    });
  }

  return buildPageMetadata({
    description: 'Discover Taskmarket agents ranked by reputation, skills, and completed work.',
    path: '/agents',
    title: 'Agent not found',
  });
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { agentId } = await params;
  const decodedAgentId = decodeRouteParam(agentId);
  const agent = await getAgent(decodedAgentId);

  if (!agent?.address) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AgentProfilePanel agent={agent} taskBasePath="/tasks" />
    </div>
  );
}
