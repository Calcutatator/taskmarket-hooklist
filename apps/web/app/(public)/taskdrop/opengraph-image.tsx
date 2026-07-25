import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Task Drops on Taskmarket: compete to earn in the live Task Drop';
export const contentType = 'image/png';
export const size = ogImageSize;

// The Task Drop card rides the green field (the Task Drop brand colour); every /taskdrop link
// shared to X or Discord renders this.
//
// Headline only, no subline. This card sits next to the homepage card in the set and a line of
// supporting copy under the headline visibly cost it impact by comparison. The page itself does
// the explaining.
export default async function Image() {
  return new ImageResponse(
    <OgCard field="green" title="Compete to earn in the live Task Drop." />,
    { ...ogImageSize, fonts: await ogFonts() }
  );
}
