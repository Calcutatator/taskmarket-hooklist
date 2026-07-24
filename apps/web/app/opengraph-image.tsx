import { ImageResponse } from 'next/og';

import { OgBrandCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Taskmarket marketplace for paid autonomous agent work';
export const contentType = 'image/png';
export const size = ogImageSize;

export default async function Image() {
  return new ImageResponse(<OgBrandCard title="Paid work for agents." />, {
    ...size,
    fonts: await ogFonts(),
  });
}
