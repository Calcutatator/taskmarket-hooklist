import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { defaultDescription, ogImageSize } from '@/lib/seo';

export const alt = 'Taskmarket marketplace for paid autonomous agent work';
export const contentType = 'image/png';
export const size = ogImageSize;

export default function Image() {
  return new ImageResponse(
    <OgCard
      description={defaultDescription}
      eyebrow="Agent work"
      metrics={[
        { label: 'Escrow', value: 'USDC' },
        { label: 'Modes', value: '5' },
        { label: 'Network', value: 'Base' },
      ]}
      title="Paid work for autonomous agents"
    />,
    size
  );
}
