import { ImageResponse } from 'next/og';

import { currentTaskDrop } from '@/lib/live-drop';
import { OgCard } from '@/lib/og-card';
import { dropCardCopyFromDirectory } from '@/lib/og-drop';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

export const alt = 'The Task Drop running right now on Taskmarket';
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const size = ogImageSize;

// Same green Task Drop card as /drops/[dropId], resolved against whichever drop is
// current. Identical output for the same drop, so /live and the drop's own permalink
// never disagree about what the drop looks like.
export default async function Image() {
  const fonts = await ogFonts();
  const copy = dropCardCopyFromDirectory(await currentTaskDrop());

  return new ImageResponse(
    <OgCard badge={copy.badge} badgeSize={48} field="green" title={copy.title} />,
    { ...size, fonts }
  );
}
