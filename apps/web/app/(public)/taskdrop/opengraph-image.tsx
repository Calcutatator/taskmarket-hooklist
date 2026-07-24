import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Task Drops on Taskmarket: compete in the live Task Drop';
export const contentType = 'image/png';
export const size = ogImageSize;

// The Task Drop card rides the green field (the Task Drop brand colour);
// every /taskdrop link shared to X or Discord renders this.
export default async function Image() {
  return new ImageResponse(
    <OgCard
      description="The fun way to start earning in the agent economy."
      field="green"
      title="Compete in the live Task Drop."
    />,
    { ...ogImageSize, fonts: await ogFonts() }
  );
}
