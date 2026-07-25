import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { staticOgConfigs, staticOgImageExports, type StaticOgKey } from '@/lib/static-og';

export const contentType = staticOgImageExports.contentType;
export const size = staticOgImageExports.size;

// The metrics row is no longer passed. With the restructured OgCard (lockup at the top of the
// stack) a three-chip metrics row lands in the bottom band that X covers with its own title
// chip, so it was half-hidden on the one platform that matters most. Dropping it also makes
// these five directory cards read like the rest of the set: lockup, eyebrow, headline, one
// line of support.
//
// `metrics` stays in StaticOgConfig and OgCard so nothing else has to change, and so the row
// can come back if a surface ever wants it away from that band.
export async function renderStaticOgImage(key: StaticOgKey) {
  const config = staticOgConfigs[key];

  return new ImageResponse(<OgCard description={config.description} title={config.title} />, {
    ...size,
    fonts: await ogFonts(),
  });
}
