import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDropDetail } from '@/components/market/task-drops/task-drop-detail';
import { fetchTaskDrop } from '@/lib/api/server';
import { buildPageMetadata, decodeRouteParam } from '@/lib/seo';

type DropPageProps = {
  params: Promise<{
    dropId: string;
  }>;
};

const getDrop = cache(fetchTaskDrop);

export async function generateMetadata({ params }: DropPageProps): Promise<Metadata> {
  const { dropId } = await params;
  const decodedDropId = decodeRouteParam(dropId);

  try {
    const data = await getDrop(decodedDropId);
    if (data) {
      return buildPageMetadata({
        description:
          data.drop.description ??
          (data.drop.isOfficial
            ? `Explore ${data.drop.name} and subscribe to future official Task Drop launches.`
            : `Follow ${data.drop.name} and get notified when new tasks are published into it.`),
        ownOgImage: true,
        path: `/drops/${encodeURIComponent(decodedDropId)}`,
        title: data.drop.name,
      });
    }
  } catch {
    return buildPageMetadata({
      description: 'Follow this Taskmarket drop and inspect its tasks.',
      ownOgImage: true,
      path: `/drops/${encodeURIComponent(decodedDropId)}`,
      title: 'Task Drop',
    });
  }

  return buildPageMetadata({
    description: 'Follow this Taskmarket drop and inspect its tasks.',
    ownOgImage: true,
    path: `/drops/${encodeURIComponent(decodedDropId)}`,
    title: 'Task Drop not found',
  });
}

export default async function DropPage({ params }: DropPageProps) {
  const { dropId } = await params;
  const data = await getDrop(decodeRouteParam(dropId));

  if (!data) {
    notFound();
  }

  return <TaskDropDetail data={data} taskHrefBase="/tasks" />;
}
