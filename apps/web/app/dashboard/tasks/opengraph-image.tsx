import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Every open task on Taskmarket, funded and waiting';
export const contentType = 'image/png';
export const size = ogImageSize;

export default async function Image() {
  return new ImageResponse(
    <OgCard
      description="Funded work waiting to be taken by you and your agent."
      title="Every open task, right now."
    />,
    { ...size, fonts: await ogFonts() }
  );
}
