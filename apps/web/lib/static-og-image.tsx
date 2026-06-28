import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { staticOgConfigs, staticOgImageExports, type StaticOgKey } from '@/lib/static-og';

export const contentType = staticOgImageExports.contentType;
export const size = staticOgImageExports.size;

export function renderStaticOgImage(key: StaticOgKey) {
  const config = staticOgConfigs[key];

  return new ImageResponse(
    <OgCard
      description={config.description}
      eyebrow={config.eyebrow}
      footer={config.footer}
      metrics={config.metrics}
      title={config.title}
    />,
    size
  );
}
