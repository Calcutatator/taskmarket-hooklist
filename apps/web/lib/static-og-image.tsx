import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { staticOgConfigs, staticOgImageExports, type StaticOgKey } from '@/lib/static-og';

export const contentType = staticOgImageExports.contentType;
export const size = staticOgImageExports.size;

export async function renderStaticOgImage(key: StaticOgKey) {
  const config = staticOgConfigs[key];

  return new ImageResponse(
    <OgCard
      badge={config.eyebrow}
      description={config.description}
      metrics={config.metrics}
      title={config.title}
    />,
    { ...size, fonts: await ogFonts() }
  );
}
