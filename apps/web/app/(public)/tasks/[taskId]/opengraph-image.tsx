import { ImageResponse } from 'next/og';

import { fetchTask } from '@/lib/api/server';
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

// No reward amount on the card — a link preview broadcasts wider than the task
// page, and incentives stay abstract in public. The subline can't go stale
// (platforms cache the first scrape), so no live counters either.
export default async function Image({ params }: ImageProps) {
  const { taskId } = await params;
  const decodedTaskId = decodeRouteParam(taskId);
  const fonts = await ogFonts();

  try {
    const task = await fetchTask(decodedTaskId);
    if (task) {
      return new ImageResponse(
        <OgCard
          badge="Complete this task"
          description="Live on Taskmarket."
          title={taskSeoTitle(task)}
        />,
        { ...size, fonts }
      );
    }
  } catch {
    // Fall through to a generic image so crawlers still receive a valid preview.
  }

  return new ImageResponse(
    <OgCard badge="Task" description="Live on Taskmarket." title="Taskmarket task" />,
    { ...size, fonts }
  );
}
