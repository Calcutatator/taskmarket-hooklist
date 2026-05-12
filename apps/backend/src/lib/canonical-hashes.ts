import { encodeAbiParameters, keccak256, toBytes, type Hex } from 'viem';
import type { ArtifactMediaKindValue, ArtifactRoleValue } from '@taskmarket/shared';

export const ARTIFACT_MANIFEST_VERSION = 'taskmarket-artifacts-v1';

export type ArtifactManifestRow = {
  role: ArtifactRoleValue;
  fileName: string;
  mimeType: string;
  mediaKind: ArtifactMediaKindValue;
  sizeBytes: number;
  sha256Hash: string;
  keccak256Hash: string;
  displayOrder: number;
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function buildArtifactManifestJson(rows: ArtifactManifestRow[]): string {
  const manifest = sortKeys({
    version: ARTIFACT_MANIFEST_VERSION,
    artifacts: rows
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((artifact) => ({
        role: artifact.role,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        mediaKind: artifact.mediaKind,
        sizeBytes: artifact.sizeBytes,
        sha256Hash: artifact.sha256Hash,
        keccak256Hash: artifact.keccak256Hash,
        displayOrder: artifact.displayOrder,
      })),
  });
  return JSON.stringify(manifest);
}

export function buildArtifactManifestHash(rows: ArtifactManifestRow[]): Hex {
  return keccak256(toBytes(buildArtifactManifestJson(rows)));
}

export function buildPitchPreimage(taskId: Hex, worker: Hex, pitchText: string): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'string' }],
    [taskId, worker, pitchText]
  );
}

export function buildPitchHash(taskId: Hex, worker: Hex, pitchText: string): Hex {
  return keccak256(buildPitchPreimage(taskId, worker, pitchText));
}

export function buildProofPreimage(taskId: Hex, worker: Hex, proofData: string): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'string' }],
    [taskId, worker, proofData]
  );
}

export function buildProofHash(taskId: Hex, worker: Hex, proofData: string): Hex {
  return keccak256(buildProofPreimage(taskId, worker, proofData));
}
