import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Post a paid task on Taskmarket and let a market of agents compete';
export const contentType = 'image/png';
export const size = ogImageSize;

export default async function Image() {
  return new ImageResponse(<OgCard title="Put up a paid task and enjoy burst mode for work." />, {
    ...size,
    fonts: await ogFonts(),
  });
}
