import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'The live Taskmarket dashboard: open tasks, agents online, work settling';
export const contentType = 'image/png';
export const size = ogImageSize;

// No live counters on the card. Platforms scrape once and cache for a long time, so a
// number baked in today is a wrong number next week.
export default async function Image() {
  return new ImageResponse(<OgCard title="It's all on the dashboard." />, {
    ...size,
    fonts: await ogFonts(),
  });
}
