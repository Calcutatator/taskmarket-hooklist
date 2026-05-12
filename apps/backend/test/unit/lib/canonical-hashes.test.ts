import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import {
  ARTIFACT_MANIFEST_VERSION,
  buildArtifactManifestHash,
  buildArtifactManifestJson,
  buildPitchHash,
  buildPitchPreimage,
  buildProofHash,
  buildProofPreimage,
  type ArtifactManifestRow,
} from '../../../src/lib/canonical-hashes';

const TASK_ID = '0x7461736b00000000000000000000000000000000000000000000000000000001' as const;
const WORKER = '0x000000000000000000000000000000000000beef' as const;

describe('canonical-hashes', () => {
  describe('artifact manifest', () => {
    const rows: ArtifactManifestRow[] = [
      {
        role: 'primary',
        fileName: 'result.png',
        mimeType: 'image/png',
        mediaKind: 'image',
        sizeBytes: 1024,
        sha256Hash: '0xaaaa',
        keccak256Hash: '0xbbbb',
        displayOrder: 0,
      },
      {
        role: 'attachment',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        mediaKind: 'text',
        sizeBytes: 42,
        sha256Hash: '0xcccc',
        keccak256Hash: '0xdddd',
        displayOrder: 1,
      },
    ];

    it('uses the v1 manifest version', () => {
      expect(ARTIFACT_MANIFEST_VERSION).toBe('taskmarket-artifacts-v1');
    });

    it('sorts keys lexicographically and orders by displayOrder', () => {
      const json = buildArtifactManifestJson(rows);
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed)).toEqual(['artifacts', 'version']);
      expect(Object.keys(parsed.artifacts[0])).toEqual([
        'displayOrder',
        'fileName',
        'keccak256Hash',
        'mediaKind',
        'mimeType',
        'role',
        'sha256Hash',
        'sizeBytes',
      ]);
      expect(parsed.artifacts.map((a: { displayOrder: number }) => a.displayOrder)).toEqual([0, 1]);
    });

    it('is order-independent for the input array', () => {
      const reversed = [...rows].reverse();
      expect(buildArtifactManifestJson(reversed)).toBe(buildArtifactManifestJson(rows));
    });

    it('manifest hash equals keccak256 of the JSON UTF-8 bytes', () => {
      const json = buildArtifactManifestJson(rows);
      const hash = buildArtifactManifestHash(rows);
      expect(hash).toBe(keccak256(toBytes(json)));
    });

    it('manifest contains no whitespace between tokens', () => {
      const json = buildArtifactManifestJson(rows);
      expect(json).not.toMatch(/[\n\t]/);
      expect(json).not.toMatch(/: /);
      expect(json).not.toMatch(/, /);
    });
  });

  describe('pitch hash', () => {
    it('preimage hashes to the on-chain hash', () => {
      const preimage = buildPitchPreimage(TASK_ID, WORKER, 'Hello pitch');
      const hash = buildPitchHash(TASK_ID, WORKER, 'Hello pitch');
      expect(hash).toBe(keccak256(preimage));
    });

    it('is domain-separated by taskId', () => {
      const otherTask = '0x7461736b00000000000000000000000000000000000000000000000000000002' as const;
      expect(buildPitchHash(TASK_ID, WORKER, 'same text')).not.toBe(
        buildPitchHash(otherTask, WORKER, 'same text')
      );
    });

    it('is domain-separated by worker', () => {
      const otherWorker = '0x000000000000000000000000000000000000cafe' as const;
      expect(buildPitchHash(TASK_ID, WORKER, 'same text')).not.toBe(
        buildPitchHash(TASK_ID, otherWorker, 'same text')
      );
    });
  });

  describe('proof hash', () => {
    it('preimage hashes to the on-chain hash', () => {
      const preimage = buildProofPreimage(TASK_ID, WORKER, 'proof body');
      const hash = buildProofHash(TASK_ID, WORKER, 'proof body');
      expect(hash).toBe(keccak256(preimage));
    });

    it('uses the same encoding shape as pitch', () => {
      // Both functions encode (bytes32, address, string), so pitch and proof
      // produce identical hashes for identical content. This is intentional —
      // domain separation across submission types comes from the contract
      // function called, not from the hash itself.
      expect(buildProofHash(TASK_ID, WORKER, 'x')).toBe(buildPitchHash(TASK_ID, WORKER, 'x'));
    });
  });
});
