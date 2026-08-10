import type { ArtifactResponse, SubmissionResponse } from '@taskmarket/shared';

import { isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';

export type PublishedHtmlArtifact = {
  artifact: ArtifactResponse;
  submission: SubmissionResponse;
};

function matchesAddress(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function submittedAtMs(submission: SubmissionResponse) {
  const value = Date.parse(submission.submittedAt);
  return Number.isFinite(value) ? value : 0;
}

export function selectPublishedHtmlArtifacts(
  submissions: SubmissionResponse[],
  primaryAwardWorker?: string | null
): PublishedHtmlArtifact[] {
  return submissions
    .filter((submission) => !submission.rejectedAt)
    .flatMap((submission) =>
      (submission.artifacts ?? [])
        .filter(isInteractiveHtmlArtifact)
        .map((artifact) => ({ artifact, submission }))
    )
    .sort((left, right) => {
      const leftAwarded = matchesAddress(left.artifact.workerAddress, primaryAwardWorker);
      const rightAwarded = matchesAddress(right.artifact.workerAddress, primaryAwardWorker);
      if (leftAwarded !== rightAwarded) {
        return leftAwarded ? -1 : 1;
      }

      const leftFinal = left.artifact.role === 'final';
      const rightFinal = right.artifact.role === 'final';
      if (leftFinal !== rightFinal) {
        return leftFinal ? -1 : 1;
      }

      const submittedAtDifference =
        submittedAtMs(right.submission) - submittedAtMs(left.submission);
      if (submittedAtDifference !== 0) {
        return submittedAtDifference;
      }

      const displayOrderDifference = left.artifact.displayOrder - right.artifact.displayOrder;
      if (displayOrderDifference !== 0) {
        return displayOrderDifference;
      }

      return left.artifact.id.localeCompare(right.artifact.id);
    });
}
