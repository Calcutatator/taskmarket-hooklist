import type { Metadata } from 'next';

import { TaskDropDetail } from '@/components/market/task-drops/task-drop-detail';
import { fetchTaskDrop } from '@/lib/api/server';
import { currentTaskDrop } from '@/lib/live-drop';
import { dropCardCopyFromDirectory } from '@/lib/og-drop';
import { buildPageMetadata } from '@/lib/seo';

import TaskDropPage from '../taskdrop/page';

/**
 * /live — the evergreen Task Drop link.
 *
 * One permanent URL that always lands on the newest drop. Paste it in the nav, in Discord, on
 * the site; when the next drop opens it points there on its own, with no link to update
 * anywhere. Every drop keeps its own permanent /drops/[dropId] URL as well — this is an
 * addition, not a replacement.
 *
 * Renders the current drop IN PLACE rather than redirecting. A redirect is the obvious
 * implementation and it is the wrong one here: several link-preview crawlers read the OG tags
 * of the *first* response, so a 302 either loses the card or resolves it against the wrong
 * URL. Rendering in place means /live has its own metadata and its own opengraph-image, and
 * the preview is correct by construction.
 *
 * No `export const revalidate` here on purpose: every read goes through `readJson` in
 * lib/api/server.ts, which sets `cache: 'no-store'`, so this segment is already dynamic per
 * request and a revalidate window would be inert.
 */
export async function generateMetadata(): Promise<Metadata> {
  const item = await currentTaskDrop();
  const fallbackCopy = dropCardCopyFromDirectory(null);

  return buildPageMetadata({
    description: item
      ? (item.drop.description ??
        `${item.drop.name}. Funded tasks, open to anyone, judged and paid when the clock runs out.`)
      : fallbackCopy.description,
    ownOgImage: true,
    path: '/live',
    title: item ? item.drop.name : fallbackCopy.title,
  });
}

export default async function LiveDropPage() {
  const item = await currentTaskDrop();
  if (!item) {
    return <TaskDropPage />;
  }

  // This is the URL we paste everywhere, so a backend blip must land somewhere useful rather
  // than 404. fetchTaskDrop throws on any non-404 failure; currentTaskDrop already swallows
  // its own.
  let data = null;
  try {
    data = await fetchTaskDrop(item.drop.id);
  } catch {
    return <TaskDropPage />;
  }

  if (!data) {
    return <TaskDropPage />;
  }

  return <TaskDropDetail data={data} taskHrefBase="/tasks" />;
}
