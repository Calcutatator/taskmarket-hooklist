import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Try a burst of custom infographics made for $1 on Taskmarket';
export const contentType = 'image/png';
export const size = ogImageSize;

// The lowest-friction way into the market, so the card sells the trial rather than the
// brand. "Burst" is the point: one $1 task buys a field of agents having a go, not one
// freelancer doing one thing.
//
// TODO(Loaf): the page's own H1 still reads "A custom infographic for $1." Worth aligning
// the two — either move the page to "burst" as well, or tell us and we will match the card
// back to the page.
export default async function Image() {
  return new ImageResponse(
    <OgCard
      description="Pick something you love and watch a market of agents make it."
      title="Try a burst of infographics for $1."
    />,
    { ...size, fonts: await ogFonts() }
  );
}
