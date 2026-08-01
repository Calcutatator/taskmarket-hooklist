import type { SubmissionResponse } from '@taskmarket/shared';

export type SubmissionReviewSort = 'newest' | 'oldest' | 'credibility';

export type WorkerSubmissionGroup = {
  workerKey: string;
  workerAddress: string;
  submissions: SubmissionResponse[];
  representativeSubmission: SubmissionResponse;
  firstSubmittedAt: string;
  latestSubmittedAt: string;
  rejected: boolean;
  workerStats: SubmissionResponse['workerStats'];
};

export type SubmissionReviewGroups = {
  activeGroups: WorkerSubmissionGroup[];
  rejectedGroups: WorkerSubmissionGroup[];
  activeSubmissionCount: number;
  rejectedSubmissionCount: number;
  totalSubmissionCount: number;
};

function compareSubmissionsNewestFirst(left: SubmissionResponse, right: SubmissionResponse) {
  const leftTimestamp = Date.parse(left.submittedAt);
  const rightTimestamp = Date.parse(right.submittedAt);
  const leftInvalid = Number.isNaN(leftTimestamp);
  const rightInvalid = Number.isNaN(rightTimestamp);

  if (leftInvalid !== rightInvalid) {
    return leftInvalid ? 1 : -1;
  }

  if (!leftInvalid && !rightInvalid && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return left.id.localeCompare(right.id);
}

export function groupSubmissionsByWorker(
  submissions: readonly SubmissionResponse[]
): SubmissionReviewGroups {
  const submissionsByWorker = new Map<string, SubmissionResponse[]>();

  for (const submission of submissions) {
    const workerKey = submission.workerAddress.toLowerCase();
    const workerSubmissions = submissionsByWorker.get(workerKey) ?? [];
    workerSubmissions.push(submission);
    submissionsByWorker.set(workerKey, workerSubmissions);
  }

  const activeGroups: WorkerSubmissionGroup[] = [];
  const rejectedGroups: WorkerSubmissionGroup[] = [];
  let activeSubmissionCount = 0;
  let rejectedSubmissionCount = 0;

  for (const [workerKey, workerSubmissions] of submissionsByWorker) {
    const sortedSubmissions = [...workerSubmissions].sort(compareSubmissionsNewestFirst);
    const representativeSubmission = sortedSubmissions[0];
    const validSubmissions = sortedSubmissions.filter(
      (submission) => !Number.isNaN(Date.parse(submission.submittedAt))
    );
    const earliestSubmission = validSubmissions.at(-1) ?? sortedSubmissions.at(-1);

    if (!representativeSubmission || !earliestSubmission) {
      continue;
    }

    const rejected = sortedSubmissions.some((submission) => Boolean(submission.rejectedAt));
    const group = {
      workerKey,
      workerAddress: representativeSubmission.workerAddress,
      submissions: sortedSubmissions,
      representativeSubmission,
      firstSubmittedAt: earliestSubmission.submittedAt,
      latestSubmittedAt: representativeSubmission.submittedAt,
      rejected,
      workerStats: representativeSubmission.workerStats,
    };

    if (rejected) {
      rejectedGroups.push(group);
      rejectedSubmissionCount += sortedSubmissions.length;
    } else {
      activeGroups.push(group);
      activeSubmissionCount += sortedSubmissions.length;
    }
  }

  return {
    activeGroups,
    rejectedGroups,
    activeSubmissionCount,
    rejectedSubmissionCount,
    totalSubmissionCount: submissions.length,
  };
}

function compareTimestamps(left: string, right: string, order: 'ascending' | 'descending') {
  const leftTimestamp = Date.parse(left);
  const rightTimestamp = Date.parse(right);
  const leftInvalid = Number.isNaN(leftTimestamp);
  const rightInvalid = Number.isNaN(rightTimestamp);

  if (leftInvalid !== rightInvalid) {
    return leftInvalid ? 1 : -1;
  }

  if (leftInvalid || leftTimestamp === rightTimestamp) {
    return 0;
  }

  return order === 'ascending' ? leftTimestamp - rightTimestamp : rightTimestamp - leftTimestamp;
}

export function sortSubmissionGroups(
  groups: readonly WorkerSubmissionGroup[],
  sort: SubmissionReviewSort
): WorkerSubmissionGroup[] {
  return [...groups].sort((left, right) => {
    if (sort === 'credibility') {
      const leftCompletedTasks = left.workerStats?.completedTasks ?? -1;
      const rightCompletedTasks = right.workerStats?.completedTasks ?? -1;
      const credibilityDifference = rightCompletedTasks - leftCompletedTasks;

      if (credibilityDifference !== 0) {
        return credibilityDifference;
      }
    }

    const timestampDifference = compareTimestamps(
      left.firstSubmittedAt,
      right.firstSubmittedAt,
      sort === 'newest' ? 'descending' : 'ascending'
    );

    return timestampDifference || left.workerKey.localeCompare(right.workerKey);
  });
}
