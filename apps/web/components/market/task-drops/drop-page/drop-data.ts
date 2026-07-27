import type { SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';

import {
  counterEntries,
  entryCount,
  pickCover,
  type DropTask,
  type DropPageDrop,
  type DropWinner,
} from '@/components/market/task-drops/drop-page/drop-state';
import { fetchTask, fetchTaskDrop, fetchTaskSubmissions } from '@/lib/api/server';
import { taskTitle } from '@/lib/market/task-title';

// Assembles everything the public drop page needs from the reads that already exist.
//
// taskDrops.get returns a thin TaskDropTask projection — id, description, reward, status, mode,
// tags, createdAt, expiryTime — with no phase, submission-window state, entry count, awards or
// media. Each task is topped up from /api/tasks/{id}, and eligible tasks also pull submissions for
// a cover. Both reads are public and run in parallel, so this is two server-side waves rather than a
// per-card client waterfall. Detail failures fail the page instead of manufacturing believable
// zero counts and empty winner data.
//
// TODO(Beau): the clean version of this is taskDrops.get returning TaskResponse[] instead of
// TaskDropTask[] — phase, submissionCount, awardCount and primaryAward all arrive with it, this
// file loses its first wave, and the drop page stops maintaining a second task projection.
//
// Nothing here may be cached. previewUrl is a presigned S3 URL with a one-hour TTL, and every read
// goes through readJson with cache: 'no-store', so the segment is dynamic per request by
// construction. Do not add `export const revalidate` to a route that renders this.

// Entry counts are derived by `entryCount` in drop-state.ts, which reconciles the two unreliable
// sources: the stale `submissionCount` field and the per-row-filtered submissions listing. The rule
// and the evidence for it live beside the tests, with the rest of the pure logic.

// Amounts are dropped on purpose. TaskAwardSchema also carries grossAmount, workerPayment and
// platformFee; the task reward is public and onchain, the split is not for a marketing surface.
function winnersOf(detail: TaskDetailResponse): DropWinner[] {
  const awards = detail.awards ?? [];
  if (awards.length > 0) {
    const seen = new Set<string>();
    return [...awards]
      .sort((a, b) => a.rank - b.rank)
      .flatMap((award) => {
        const address = award.workerAddress.toLowerCase();
        if (seen.has(address)) {
          return [];
        }
        seen.add(address);
        return [
          {
            rank: award.rank,
            rating: award.rating,
            workerAddress: award.workerAddress,
            workerAgentId: award.workerAgentId,
          },
        ];
      });
  }

  if (detail.primaryAward) {
    return [
      {
        rank: 1,
        rating: detail.primaryAward.rating,
        workerAddress: detail.primaryAward.workerAddress,
        workerAgentId: null,
      },
    ];
  }

  return [];
}

// Fetched for every task the visibility rules allow, not only ones the counter claims have entries —
// the counter is exactly what we no longer trust. Pitch and auction tasks produce no submissions, so
// they are skipped. This is a real increase in reads over the old code, which skipped any task whose
// counter read zero.
function wantsSubmissions(detail: TaskDetailResponse) {
  if (detail.mode === 'pitch' || detail.mode === 'auction') {
    return false;
  }
  return detail.submissionVisibility !== 'never' && detail.taskVisibility !== 'private';
}

export async function loadDropPage(
  dropId: string
): Promise<{ drop: DropPageDrop; tasks: DropTask[] } | null> {
  const data = await fetchTaskDrop(dropId);
  if (!data) {
    return null;
  }

  const details = await Promise.all(data.tasks.map((task) => fetchTask(task.id)));
  if (details.some((detail) => detail === null)) {
    throw new Error('A task in this drop is no longer available');
  }
  const loadedDetails = details.filter((detail): detail is TaskDetailResponse => detail !== null);

  const submissions = await Promise.all(
    loadedDetails.map((detail, index): Promise<SubmissionResponse[]> => {
      if (!wantsSubmissions(detail)) {
        return Promise.resolve([]);
      }
      return fetchTaskSubmissions(data.tasks[index].id, { includePreviewUrls: 'media' });
    })
  );

  const tasks: DropTask[] = data.tasks.map((task, index) => {
    const detail = loadedDetails[index];
    const visibleSubmissions = submissions[index];
    const winners = winnersOf(detail);
    const primary = winners[0];
    const cover = primary
      ? pickCover(visibleSubmissions, primary.workerAddress)
      : pickCover(visibleSubmissions);

    return {
      acceptsEntries: detail.submissionWindowOpen,
      cover,
      entries: entryCount(detail, visibleSubmissions),
      expiryTime: task.expiryTime,
      id: task.id,
      mode: detail.mode,
      phase: detail.phase,
      reward: task.reward,
      title: taskTitle(task),
      winners,
      // An empty field on a task the counter says has entries means the visibility rule is hiding
      // the work, not that nothing was submitted.
      workIsPublic:
        detail.submissionVisibility !== 'never' &&
        (visibleSubmissions.length > 0 || counterEntries(detail) === 0),
    };
  });

  return {
    drop: {
      description: data.drop.description,
      id: data.drop.id,
      isOfficial: data.drop.isOfficial,
      name: data.drop.name,
      officialWalletAddress: data.drop.officialWalletAddress,
      ownerAddress: data.drop.ownerAddress,
    },
    tasks,
  };
}
