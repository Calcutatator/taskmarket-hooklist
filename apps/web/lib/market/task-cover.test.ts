import type { ArtifactResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { isMediaArtifact, isPlayableArtifact } from './task-cover';

// Minimal-but-complete ArtifactResponse fixture; override per test.
function makeArtifact(overrides: Partial<ArtifactResponse> = {}): ArtifactResponse {
  return {
    id: 'artifact-1',
    taskId: 'task-1',
    submissionId: 'submission-1',
    workerAddress: '0x1111111111111111111111111111111111111111',
    workerAgentId: null,
    role: 'preview',
    fileName: 'preview.png',
    mimeType: 'image/png',
    mediaKind: 'image',
    storageUri: 'https://storage.example/artifact-1',
    sizeBytes: 1024,
    sha256Hash: 'sha256',
    keccak256Hash: 'keccak256',
    displayOrder: 0,
    ...overrides,
  };
}

describe('isPlayableArtifact', () => {
  it('returns true for image artifacts', () => {
    expect(isPlayableArtifact(makeArtifact({ mediaKind: 'image' }))).toBe(true);
  });

  it('returns true for video artifacts', () => {
    expect(isPlayableArtifact(makeArtifact({ mediaKind: 'video' }))).toBe(true);
  });

  it('returns true for an interactive HTML artifact classified as text', () => {
    const artifact = makeArtifact({
      fileName: 'candidate-a-calculator.html',
      mediaKind: 'text',
      mimeType: 'text/html',
    });
    expect(isPlayableArtifact(artifact)).toBe(true);
  });

  it('returns true for a parameterized text/html mimetype', () => {
    const artifact = makeArtifact({
      fileName: 'candidate-a-calculator.html',
      mediaKind: 'text',
      mimeType: 'text/html; charset=utf-8',
    });
    expect(isPlayableArtifact(artifact)).toBe(true);
  });

  it('returns true for a .html filename with a generic mimetype', () => {
    const artifact = makeArtifact({
      fileName: 'candidate-a-calculator.html',
      mediaKind: 'text',
      mimeType: 'application/octet-stream',
    });
    expect(isPlayableArtifact(artifact)).toBe(true);
  });

  it('returns false for a plain text artifact', () => {
    const artifact = makeArtifact({
      fileName: 'notes.txt',
      mediaKind: 'text',
      mimeType: 'text/plain',
    });
    expect(isPlayableArtifact(artifact)).toBe(false);
  });

  it('returns false for an archive artifact', () => {
    const artifact = makeArtifact({
      fileName: 'evidence-bundle.zip',
      mediaKind: 'archive',
      mimeType: 'application/zip',
    });
    expect(isPlayableArtifact(artifact)).toBe(false);
  });
});

describe('isMediaArtifact', () => {
  it('still returns false for an interactive HTML artifact', () => {
    const artifact = makeArtifact({
      fileName: 'candidate-a-calculator.html',
      mediaKind: 'text',
      mimeType: 'text/html',
    });
    expect(isMediaArtifact(artifact)).toBe(false);
  });
});
