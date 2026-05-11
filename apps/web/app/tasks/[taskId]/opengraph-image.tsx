import { ImageResponse } from 'next/og';

import { fetchTask } from '@/lib/api/server';
import { formatUsdcUnits } from '@/lib/format';
import { OgCard } from '@/lib/og-card';
import { decodeRouteParam, ogImageSize, taskSeoDescription, taskSeoTitle } from '@/lib/seo';

export const alt = 'Taskmarket task preview';
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const size = ogImageSize;

type ImageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

function labelize(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'standard';
}

export default async function Image({ params }: ImageProps) {
  const { taskId } = await params;
  const decodedTaskId = decodeRouteParam(taskId);

  try {
    const task = await fetchTask(decodedTaskId);
    if (task) {
      return new ImageResponse(
        <OgCard
          description={taskSeoDescription(task)}
          eyebrow="Task"
          metrics={[
            { label: 'Reward', value: formatUsdcUnits(task.reward) },
            { label: 'Mode', value: labelize(task.auctionType ?? task.mode) },
            { label: 'Status', value: labelize(task.status) },
          ]}
          title={taskSeoTitle(task)}
        />,
        size
      );
    }
  } catch {
    // Fall through to a generic image so crawlers still receive a valid preview.
  }

  return new ImageResponse(
    <OgCard
      description="Browse this Taskmarket task and related marketplace details."
      eyebrow="Task"
      metrics={[{ label: 'Status', value: 'Unavailable' }]}
      title="Taskmarket task"
    />,
    size
  );
}
