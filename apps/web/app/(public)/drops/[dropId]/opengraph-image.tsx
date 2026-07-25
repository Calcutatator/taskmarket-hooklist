import { ImageResponse } from 'next/og';

import { fetchTaskDrop } from '@/lib/api/server';
import { OgCard } from '@/lib/og-card';
import { dropCardCopy } from '@/lib/og-drop';
import { ogFonts } from '@/lib/og-fonts';
import { decodeRouteParam, ogImageSize } from '@/lib/seo';

export const alt = 'Task Drop on Taskmarket';
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const size = ogImageSize;

type ImageProps = {
  params: Promise<{
    dropId: string;
  }>;
};

// Every drop link renders its own card: the call to action, then the drop's name. Rides the
// Task Drop green field so a drop never looks like a plain marketplace link.
//
// The open-task count and prize fund are deliberately NOT on the image — three stacked text
// elements made the busiest card in the set. They still travel: `copy.description` is the
// drop page's og:description, which Discord and Slack render as text beside the card. Nothing
// is lost, and the image keeps its impact.
//
// Falls back to a generic Task Drop card if the API is unreachable, so a shared link never
// comes back with a dead image.
export default async function Image({ params }: ImageProps) {
  const { dropId } = await params;
  const fonts = await ogFonts();

  let copy = dropCardCopy(null);
  try {
    copy = dropCardCopy(await fetchTaskDrop(decodeRouteParam(dropId)));
  } catch {
    // Keep the fallback copy.
  }

  return new ImageResponse(
    <OgCard badge={copy.badge} badgeSize={48} field="green" title={copy.title} />,
    { ...size, fonts }
  );
}
