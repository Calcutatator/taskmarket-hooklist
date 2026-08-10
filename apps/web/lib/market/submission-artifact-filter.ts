import type { ArtifactResponse } from '@taskmarket/shared';

import { isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';

export const SUBMISSION_ARTIFACT_FILTERS = ['all', 'html', 'image', 'video'] as const;

export type SubmissionArtifactFilter = (typeof SUBMISSION_ARTIFACT_FILTERS)[number];
export type SubmissionArtifactType = Exclude<SubmissionArtifactFilter, 'all'>;

export function submissionArtifactType(
  artifact: Pick<ArtifactResponse, 'fileName' | 'mediaKind' | 'mimeType'>
): SubmissionArtifactType | null {
  if (isInteractiveHtmlArtifact(artifact)) {
    return 'html';
  }

  if (artifact.mediaKind === 'image' || artifact.mediaKind === 'video') {
    return artifact.mediaKind;
  }

  return null;
}

export function countSubmissionArtifactTypes(
  artifacts: readonly Pick<ArtifactResponse, 'fileName' | 'mediaKind' | 'mimeType'>[]
): Record<SubmissionArtifactType, number> {
  const counts: Record<SubmissionArtifactType, number> = { html: 0, image: 0, video: 0 };

  for (const artifact of artifacts) {
    const type = submissionArtifactType(artifact);
    if (type) {
      counts[type] += 1;
    }
  }

  return counts;
}

export function defaultSubmissionArtifactFilter(
  counts: Record<SubmissionArtifactType, number>,
  preferredType?: SubmissionArtifactType | null
): SubmissionArtifactFilter {
  if (preferredType && counts[preferredType] > 0) {
    return preferredType;
  }

  // Interactive HTML is normally the primary experience while images and videos
  // are supporting evidence. Surface it first whenever it is present, but keep
  // "All" one tap away so a viewer never loses access to another deliverable.
  if (counts.html > 0) {
    return 'html';
  }

  const availableTypes = (['image', 'video'] as const).filter((type) => counts[type] > 0);
  return availableTypes.length === 1 ? availableTypes[0] : 'all';
}

export function matchesSubmissionArtifactFilter(
  artifact: Pick<ArtifactResponse, 'fileName' | 'mediaKind' | 'mimeType'>,
  filter: SubmissionArtifactFilter
) {
  return filter === 'all' || submissionArtifactType(artifact) === filter;
}
