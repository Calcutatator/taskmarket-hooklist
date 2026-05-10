import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
