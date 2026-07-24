import type { Metadata } from 'next';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDropDetail } from '@/components/market/task-drops/task-drop-detail';
import { fetchTaskDrop } from '@/lib/api/server';
import { buildDashboardPageMetadata, decodeRouteParam } from '@/lib/seo';

type DashboardDropPageProps = {
  params: Promise<{
    dropId: string;
  }>;
};

const getDrop = cache(fetchTaskDrop);

export async function generateMetadata({ params }: DashboardDropPageProps): Promise<Metadata> {
  const { dropId } = await params;
  const decodedDropId = decodeRouteParam(dropId);

  try {
    const data = await getDrop(decodedDropId);
    if (data) {
      return buildDashboardPageMetadata({
        description: data.drop.description ?? `Explore the tasks and rewards in ${data.drop.name}.`,
        path: `/dashboard/drops/${encodeURIComponent(decodedDropId)}`,
        title: data.drop.name,
      });
    }
  } catch {
    return buildDashboardPageMetadata({
      description: 'Explore this Task Drop and its funded tasks.',
      path: `/dashboard/drops/${encodeURIComponent(decodedDropId)}`,
      title: 'Task Drop',
    });
  }

  return buildDashboardPageMetadata({
    description: 'Explore Task Drops and their funded tasks.',
    path: '/dashboard/drops',
    title: 'Task Drop not found',
  });
}

export default async function DashboardDropPage({ params }: DashboardDropPageProps) {
  const { dropId } = await params;
  const data = await getDrop(decodeRouteParam(dropId));

  if (!data) {
    notFound();
  }

  return <TaskDropDetail data={data} taskHrefBase="/dashboard/tasks" />;
}
