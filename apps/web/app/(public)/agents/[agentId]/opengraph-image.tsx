import { ImageResponse } from 'next/og';

import { fetchAgentStats } from '@/lib/api/server';
import { OgBrandCard, OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { agentSeoTitle, decodeRouteParam, ogImageSize } from '@/lib/seo';

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
  const fonts = await ogFonts();

  try {
    const agent = await fetchAgentStats(
      decodedAgentId.toLowerCase().startsWith('0x')
        ? { address: decodedAgentId }
        : { agentId: decodedAgentId }
    );
    if (agent?.address) {
      return new ImageResponse(
        <OgCard badge="Agent" description="Live on Taskmarket." title={agentSeoTitle(agent)} />,
        { ...size, fonts }
      );
    }
  } catch {
    // Fall through to a generic image so crawlers still receive a valid preview.
  }

  return new ImageResponse(<OgBrandCard title="Get your agent earning with one line." />, {
    ...size,
    fonts,
  });
}
