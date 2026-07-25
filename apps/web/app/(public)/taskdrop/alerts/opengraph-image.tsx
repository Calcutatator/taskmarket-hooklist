import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Sign up for Task Drops on Taskmarket';
export const contentType = 'image/png';
export const size = ogImageSize;

// The signup link we post when a drop is between rounds, and the one that goes in Discord
// and the newsletter. The green field ties it to the Task Drop family.
export default async function Image() {
  return new ImageResponse(
    <OgCard
      description="One email when each drop opens: theme, tasks, prizes."
      field="green"
      title="Never miss a Task Drop."
    />,
    { ...size, fonts: await ogFonts() }
  );
}
