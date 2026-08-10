import type { ArtifactResponse, SubmissionResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { selectPublishedHtmlArtifacts } from './published-html';

function artifact(overrides: Partial<ArtifactResponse>): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'result.html',
    id: 'artifact-html',
    keccak256Hash: `0x${'2'.repeat(64)}`,
    mediaKind: 'text',
    mimeType: 'text/html',
    role: 'final',
    sha256Hash: '1'.repeat(64),
    sizeBytes: 1024,
    storageUri: 's3://taskmarket/result.html',
    submissionId: 'submission-1',
    taskId: 'task-1',
    workerAddress: '0x1111111111111111111111111111111111111111',
    workerAgentId: null,
    ...overrides,
  };
}

function submission(
  id: string,
  submittedAt: string,
  artifacts: ArtifactResponse[],
  rejectedAt: string | null = null
): SubmissionResponse {
  return {
    artifacts,
    fileUrl: 's3://taskmarket/submission',
    id,
    rejectedAt,
    signature: '0xsignature',
    submittedAt,
    taskId: 'task-1',
    workerAddress: artifacts[0]?.workerAddress ?? '0x0',
  };
}

describe('selectPublishedHtmlArtifacts', () => {
  it('filters non-HTML files and puts the primary awarded worker first', () => {
    const awardedWorker = '0x2222222222222222222222222222222222222222';
    const recent = artifact({
      id: 'recent-html',
      submissionId: 'submission-recent',
    });
    const awarded = artifact({
      id: 'awarded-html',
      submissionId: 'submission-awarded',
      workerAddress: awardedWorker.toUpperCase(),
    });
    const image = artifact({
      fileName: 'screenshot.png',
      id: 'image',
      mediaKind: 'image',
      mimeType: 'image/png',
    });

    const result = selectPublishedHtmlArtifacts(
      [
        submission('submission-recent', '2026-08-08T02:00:00.000Z', [recent, image]),
        submission('submission-awarded', '2026-08-07T02:00:00.000Z', [awarded]),
      ],
      awardedWorker
    );

    expect(result.map((entry) => entry.artifact.id)).toEqual(['awarded-html', 'recent-html']);
  });

  it('prefers final files, then newer submissions, with deterministic artifact order', () => {
    const preview = artifact({ id: 'preview', role: 'preview' });
    const olderFinal = artifact({ id: 'older-final', submissionId: 'submission-old' });
    const laterDisplayOrder = artifact({
      displayOrder: 2,
      id: 'later-display-order',
      submissionId: 'submission-new',
    });
    const firstDisplayOrder = artifact({
      displayOrder: 1,
      id: 'first-display-order',
      submissionId: 'submission-new',
    });

    const result = selectPublishedHtmlArtifacts([
      submission('submission-preview', '2026-08-09T02:00:00.000Z', [preview]),
      submission('submission-old', '2026-08-07T02:00:00.000Z', [olderFinal]),
      submission('submission-new', '2026-08-08T02:00:00.000Z', [
        laterDisplayOrder,
        firstDisplayOrder,
      ]),
    ]);

    expect(result.map((entry) => entry.artifact.id)).toEqual([
      'first-display-order',
      'later-display-order',
      'older-final',
      'preview',
    ]);
  });

  it('never promotes a rejected submission as a public HTML result', () => {
    const accepted = artifact({ id: 'accepted-html', submissionId: 'submission-accepted' });
    const rejected = artifact({ id: 'rejected-html', submissionId: 'submission-rejected' });

    const result = selectPublishedHtmlArtifacts([
      submission('submission-accepted', '2026-08-07T02:00:00.000Z', [accepted]),
      submission(
        'submission-rejected',
        '2026-08-08T02:00:00.000Z',
        [rejected],
        '2026-08-08T03:00:00.000Z'
      ),
    ]);

    expect(result.map((entry) => entry.artifact.id)).toEqual(['accepted-html']);
  });
});
