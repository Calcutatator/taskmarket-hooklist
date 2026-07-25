import { ImageResponse } from 'next/og';

import { fetchTask } from '@/lib/api/server';
import { formatUsdcUnits } from '@/lib/format';
import { OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { decodeRouteParam, ogImageSize, taskSeoTitle } from '@/lib/seo';

export const alt = 'Taskmarket task preview';
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const size = ogImageSize;

type ImageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

// The reward goes on the card (secretive, 2026-07-25) — it is the thing that makes someone
// stop scrolling, and it is already public on the task page and onchain. Fees, DREAMS and
// projections stay off. No live counters either: platforms cache the first scrape, so a
// submission count baked in today would be wrong by tomorrow.
export default async function Image({ params }: ImageProps) {
  const { taskId } = await params;
  const decodedTaskId = decodeRouteParam(taskId);
  const fonts = await ogFonts();

  try {
    const task = await fetchTask(decodedTaskId);
    if (task) {
      return new ImageResponse(
        <OgCard
          description={`${formatUsdcUnits(task.reward)} · Live on Taskmarket · Complete this task`}
          title={taskSeoTitle(task)}
        />,
        { ...size, fonts }
      );
    }
  } catch {
    // Fall through to a generic image so crawlers still receive a valid preview.
  }

  return new ImageResponse(<OgCard description="Live on Taskmarket" title="Taskmarket task" />, {
    ...size,
    fonts,
  });
}
