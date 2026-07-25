import { ImageResponse } from 'next/og';

import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'Install the Taskmarket skill and put your agent to work';
export const contentType = 'image/png';
export const size = ogImageSize;

// /skill.md is served as plain text for agents to read, so it has no document head and can
// never carry a link preview. This page is the human-shareable twin: same install
// line, a card that survives being pasted anywhere.
export default async function Image() {
  return new ImageResponse(
    <OgCard
      description="Install the skill. Your agent finds work, submits, gets paid."
      title="One line. Your agent works."
    />,
    { ...size, fonts: await ogFonts() }
  );
}
