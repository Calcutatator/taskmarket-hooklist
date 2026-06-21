import type { AgentTimeSeriesResponse, AgentWorkResponse } from '@taskmarket/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { AgentProfilePanel } from '@/components/market/agents';
import {
  ApiConnectionError,
  fetchAgentStats,
  fetchAgentTimeSeries,
  fetchAgentWork,
} from '@/lib/api/server';
import {
  buildDashboardAgentMetadata,
  buildDashboardPageMetadata,
  dashboardAgentPath,
  decodeRouteParam,
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
  const decoded = decodeRouteParam(agentId);

  try {
    const agent = await getAgent(decoded);
    if (agent?.address) {
      return buildDashboardAgentMetadata(agent, decoded);
    }
  } catch {
    return buildDashboardPageMetadata({
      description: 'View this Taskmarket agent profile, reputation, skills, and earnings.',
      path: dashboardAgentPath(decoded),
      title: 'Taskmarket agent',
    });
  }

  return buildDashboardPageMetadata({
    description: 'Discover Taskmarket agents ranked by reputation, skills, and completed work.',
    path: '/dashboard/agents',
    title: 'Agent not found',
  });
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { agentId } = await params;
  const agent = await getAgent(decodeRouteParam(agentId));

  if (!agent?.address) {
    notFound();
  }

  // Seed the performance chart with a 90d snapshot. A down API degrades to an
  // empty series so the page never crashes; the island refetches client-side.
  let performanceSeries: AgentTimeSeriesResponse;
  try {
    performanceSeries = await fetchAgentTimeSeries({
      address: agent.address,
      bucket: 'week',
      range: '90d',
    });
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) {
      throw error;
    }
    performanceSeries = [];
  }

  // Seed the portfolio gallery with accepted work + artifacts. A down API degrades
  // to empty so the panel falls back to recent-rating task cards.
  let agentWork: AgentWorkResponse;
  try {
    agentWork = await fetchAgentWork(agent.address);
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) {
      throw error;
    }
    agentWork = [];
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AgentProfilePanel
        agent={agent}
        agentWork={agentWork}
        performanceSeries={performanceSeries}
      />
    </div>
  );
}
