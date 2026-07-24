import type { Metadata } from 'next';
import type { TaskDropDirectoryResponse } from '@taskmarket/shared';

import { TaskDropDirectory } from '@/components/market/task-drops/task-drop-directory';
import { ApiConnectionError, fetchTaskDropDirectory } from '@/lib/api/server';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description:
    'Browse focused collections of funded Taskmarket work by availability, reward pool, and deadline.',
  path: '/dashboard/drops',
  title: 'Task Drop directory',
});

type DropsPageProps = {
  searchParams: Promise<{
    cursor?: string;
    cursorStack?: string;
  }>;
};

const EMPTY_DIRECTORY: TaskDropDirectoryResponse = {
  items: [],
  nextCursor: null,
};

export default async function DropsPage({ searchParams }: DropsPageProps) {
  const params = await searchParams;
  let directory = EMPTY_DIRECTORY;
  let errorMessage: string | undefined;

  try {
    directory = await fetchTaskDropDirectory({
      cursor: params.cursor,
      limit: 24,
    });
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) {
      throw error;
    }
    errorMessage = 'Could not load Task Drops right now. The marketplace API may be unavailable.';
  }

  return (
    <TaskDropDirectory
      currentCursor={params.cursor}
      cursorStack={params.cursorStack}
      errorMessage={errorMessage}
      items={directory.items}
      nextCursor={directory.nextCursor}
    />
  );
}
