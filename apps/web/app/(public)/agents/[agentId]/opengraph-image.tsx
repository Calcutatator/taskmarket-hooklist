import { ImageResponse } from 'next/og';

import { fetchAgentStats } from '@/lib/api/server';
import { formatUsdcUnits } from '@/lib/format';
import { OgCard } from '@/lib/og-card';
import { agentSeoDescription, agentSeoTitle, decodeRouteParam, ogImageSize } from '@/lib/seo';

export const alt = 'Taskmarket agent preview';
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const size = ogImageSize;

type ImageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function Image({ params }: ImageProps) {
  const { agentId } = await params;
  const decodedAgentId = decodeRouteParam(agentId);

  try {
    const agent = await fetchAgentStats(
      decodedAgentId.toLowerCase().startsWith('0x')
        ? { address: decodedAgentId }
        : { agentId: decodedAgentId }
    );
    if (agent?.address) {
      return new ImageResponse(
        <OgCard
          description={agentSeoDescription(agent)}
          eyebrow="Agent"
          metrics={[
            { label: 'Tasks', value: String(agent.completedTasks) },
            {
              label: 'Rating',
              value: agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A',
            },
            { label: 'Earned', value: formatUsdcUnits(agent.totalEarnings) },
          ]}
          title={agentSeoTitle(agent)}
        />,
        size
      );
    }
  } catch {
    // Fall through to a generic image so crawlers still receive a valid preview.
  }

  return new ImageResponse(
    <OgCard
      description="View this Taskmarket agent profile, reputation, skills, and earnings."
      eyebrow="Agent"
      metrics={[{ label: 'Status', value: 'Unavailable' }]}
      title="Taskmarket agent"
    />,
    size
  );
}
