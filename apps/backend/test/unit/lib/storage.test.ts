import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { getStorageBackend } from '../../../src/lib/storage';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/taskmarket',
  BASE_RPC_URL: 'https://example-rpc.local',
  CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
  FORWARDER_ADDRESS: '0x3333333333333333333333333333333333333333',
  USDC_TOKEN_ADDRESS: '0x2222222222222222222222222222222222222222',
  SERVER_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
};

describe('storage backend', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
      NODE_ENV: 'development',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes local file URIs into served upload URLs', async () => {
    const storage = getStorageBackend();

    await expect(
      storage.getPresignedUrl('file://uploads/submissions/task/submission/artifact.png')
    ).resolves.toBe('http://localhost:3000/uploads/submissions/task/submission/artifact.png');
    await expect(
      storage.getPresignedUrl('file://./uploads/submissions/task/submission/artifact.png')
    ).resolves.toBe('http://localhost:3000/uploads/submissions/task/submission/artifact.png');
    await expect(storage.getPresignedUrl('submissions/task/submission/artifact.png')).resolves.toBe(
      'http://localhost:3000/uploads/submissions/task/submission/artifact.png'
    );
  });

  it('normalizes an absolute file:// URI the same way upload() actually returns it', async () => {
    // Regression test: upload()/storageUriForKey() always resolve the key to an
    // absolute path before returning `file://${filePath}` (resolveKeyPath() always
    // resolves against the uploads root) -- the relative-only fixtures above never
    // exercised that real shape, which is exactly how this bug went unnoticed. An
    // absolute file:// URI must rebase against the real uploads root, not leak the
    // raw filesystem path into the served URL (the doubled `/uploads//home/...` 404).
    const storage = getStorageBackend();
    const absolutePath = resolve('./uploads', 'submissions/task/submission/artifact.png');

    await expect(storage.getPresignedUrl(`file://${absolutePath}`)).resolves.toBe(
      'http://localhost:3000/uploads/submissions/task/submission/artifact.png'
    );
  });

  it('getPresignedUrl refuses an absolute path outside the uploads directory', async () => {
    const storage = getStorageBackend();
    await expect(storage.getPresignedUrl('file:///etc/passwd')).rejects.toThrow(
      /outside the uploads directory/
    );
  });

  describe('path traversal containment', () => {
    it('headObject cannot reach a real file that exists just outside the uploads directory', async () => {
      // A genuinely existing file just outside ./uploads -- if the traversal check is
      // missing, join() resolves the `../` straight to it and stat() succeeds, which
      // would prove the escape actually works, not just that a nonexistent path 404s.
      const escapeTarget = resolve(process.cwd(), 'storage-test-escape-marker.txt');
      await writeFile(escapeTarget, 'should never be reachable via the uploads key namespace');
      try {
        const storage = getStorageBackend();
        await expect(
          storage.headObject('submissions/attacker-task/../../../storage-test-escape-marker.txt')
        ).resolves.toBeNull();
      } finally {
        await unlink(escapeTarget);
      }
    });

    it('headObject still resolves a legitimate same-directory key normally', async () => {
      const storage = getStorageBackend();
      // A nonexistent-but-well-formed key resolves inside the uploads dir and returns
      // null only because the file doesn't exist -- proving the check isn't rejecting
      // every key, just ones that escape the root.
      await expect(
        storage.headObject('submissions/some-task/some-submission/artifact.png')
      ).resolves.toBeNull();
    });

    it('upload refuses to write outside the uploads directory', async () => {
      const storage = getStorageBackend();
      await expect(
        storage.upload('../../../tmp/evil.txt', Buffer.from('x'))
      ).rejects.toThrow(/outside the uploads directory/);
    });

    it('storageUriForKey refuses to resolve a URI outside the uploads directory', () => {
      const storage = getStorageBackend();
      expect(() => storage.storageUriForKey('../../../etc/passwd')).toThrow(
        /outside the uploads directory/
      );
    });
  });
});
