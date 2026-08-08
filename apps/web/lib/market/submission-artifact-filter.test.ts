import type { ArtifactResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import {
  countSubmissionArtifactTypes,
  defaultSubmissionArtifactFilter,
  matchesSubmissionArtifactFilter,
  submissionArtifactType,
} from './submission-artifact-filter';

function artifact(overrides: Partial<ArtifactResponse> = {}): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'result.png',
    id: 'artifact-1',
    keccak256Hash: '0xhash',
    mediaKind: 'image',
    mimeType: 'image/png',
    role: 'final',
    sha256Hash: 'hash',
    sizeBytes: 1,
    storageUri: 's3://taskmarket/result.png',
    submissionId: 'submission-1',
    taskId: 'task-1',
    workerAddress: '0x1111111111111111111111111111111111111111',
    workerAgentId: null,
    ...overrides,
  };
}

describe('submission artifact filtering', () => {
  it('classifies interactive HTML before its generic text media kind', () => {
    expect(
      submissionArtifactType(
        artifact({ fileName: 'result.html', mediaKind: 'text', mimeType: 'text/html' })
      )
    ).toBe('html');
  });

  it('defaults to HTML when present and honors an available creator preference', () => {
    const counts = countSubmissionArtifactTypes([
      artifact(),
      artifact({ fileName: 'result.html', mediaKind: 'text', mimeType: 'text/html' }),
      artifact({ fileName: 'demo.mp4', mediaKind: 'video', mimeType: 'video/mp4' }),
    ]);

    expect(defaultSubmissionArtifactFilter(counts)).toBe('html');
    expect(defaultSubmissionArtifactFilter(counts, 'video')).toBe('video');
    expect(defaultSubmissionArtifactFilter(counts, 'image')).toBe('image');
  });

  it('falls back safely when a preferred type has no visible artifacts', () => {
    const image = artifact();
    const counts = countSubmissionArtifactTypes([image]);

    expect(defaultSubmissionArtifactFilter(counts, 'video')).toBe('image');
    expect(matchesSubmissionArtifactFilter(image, 'image')).toBe(true);
    expect(matchesSubmissionArtifactFilter(image, 'video')).toBe(false);
    expect(matchesSubmissionArtifactFilter(image, 'all')).toBe(true);
  });
});
