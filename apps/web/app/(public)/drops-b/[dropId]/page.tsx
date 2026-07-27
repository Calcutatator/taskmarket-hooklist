import type { Metadata } from 'next';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { loadDropPage } from '@/components/market/task-drops/drop-page/drop-data';
import { DropPageView } from '@/components/market/task-drops/drop-page/drop-page-view';
import {
  isSampleState,
  SAMPLE_DROP_ID,
  sampleDrop,
  sampleDropTasks,
} from '@/components/market/task-drops/drop-page/sample-drop';
import { buildPageMetadata, decodeRouteParam } from '@/lib/seo';

/**
 * Task Drop page, preview route.
 *
 * The redesigned public drop page, routed at /drops-b/[dropId] so it can be reviewed against real
 * data without touching /drops/[dropId] or the dashboard's TaskDropDetail. Moving it onto the real
 * route is a two-line change in app/(public)/drops/[dropId]/page.tsx once it is signed off:
 * swap fetchTaskDrop + TaskDropDetail for loadDropPage + DropPageView.
 *
 * /drops-b/sample renders a fixture so the preview URL always shows a full drop; add
 * ?state=upcoming|live|judging|settling|finished to walk the lifecycle. Both the sample branch and
 * sample-drop.ts go away with the route swap.
 *
 * No `export const revalidate` here on purpose — see the note in drop-data.ts.
 */

type DropPageProps = {
  params: Promise<{ dropId: string }>;
  searchParams: Promise<{ state?: string }>;
};

const getDropPage = cache(loadDropPage);

export async function generateMetadata({ params }: DropPageProps): Promise<Metadata> {
  const { dropId } = await params;
  const decodedDropId = decodeRouteParam(dropId);
  const path = `/drops-b/${encodeURIComponent(decodedDropId)}`;

  if (decodedDropId === SAMPLE_DROP_ID) {
    return buildPageMetadata({
      description: 'Preview of the Task Drop page against a sample drop.',
      path,
      title: sampleDrop.name,
    });
  }

  try {
    const data = await getDropPage(decodedDropId);
    if (data) {
      return buildPageMetadata({
        description:
          data.drop.description ??
          `Compete in ${data.drop.name}: funded tasks, judged by hand, paid on acceptance.`,
        path,
        title: data.drop.name,
      });
    }
  } catch {
    return buildPageMetadata({
      description: 'Follow this Taskmarket drop and inspect its tasks.',
      path,
      title: 'Task Drop',
    });
  }

  return buildPageMetadata({
    description: 'Follow this Taskmarket drop and inspect its tasks.',
    path,
    title: 'Task Drop not found',
  });
}

export default async function DropPreviewPage({ params, searchParams }: DropPageProps) {
  const { dropId } = await params;
  const decodedDropId = decodeRouteParam(dropId);

  if (decodedDropId === SAMPLE_DROP_ID) {
    const { state } = await searchParams;
    const resolved = isSampleState(state) ? state : 'finished';

    return (
      <DropPageView
        drop={sampleDrop}
        isPreviewFixture
        showLiveDropLink
        tasks={sampleDropTasks(resolved)}
      />
    );
  }

  const data = await getDropPage(decodedDropId);

  if (!data) {
    notFound();
  }

  return <DropPageView drop={data.drop} showLiveDropLink tasks={data.tasks} />;
}
