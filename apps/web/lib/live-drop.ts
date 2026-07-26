import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import { cache } from 'react';

import { fetchTaskDropDirectory } from '@/lib/api/server';

/**
 * Resolves "the current Task Drop" for the evergreen /live URL.
 *
 * The drop directory is already ordered with the current official drop first — that
 * ordering is what the /taskdrop line "The current official drop appears first in the
 * Task Drops room" relies on — so this reads existing behaviour rather than inventing a
 * new contract. We still prefer the first `isOfficial` row explicitly, then fall back to
 * the newest row of any kind.
 *
 * TODO(Loaf): if the backend gains an explicit "current official drop" flag or endpoint,
 * point this at it. Ordering is the one assumption in the whole /live feature.
 */
export const currentTaskDrop = cache(async (): Promise<TaskDropDirectoryItem | null> => {
  try {
    const directory = await fetchTaskDropDirectory({ limit: 24 });
    const items = directory?.items ?? [];
    if (items.length === 0) {
      return null;
    }

    return items.find((item) => item.drop.isOfficial) ?? items[0];
  } catch {
    return null;
  }
});
