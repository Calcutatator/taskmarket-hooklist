import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
  writeFileSync: vi.fn(),
}));

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn(),
}));

vi.mock('../../src/lib/signer.js', () => ({
  signMessage: vi.fn(),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiPost: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn((message: string) => {
    throw new Error(message);
  }),
}));

import { promises as fs, writeFileSync } from 'fs';
import { submitCmd } from '../../src/commands/task/submit.js';
import { downloadCmd } from '../../src/commands/task/download.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { signMessage } from '../../src/lib/signer.js';
import { apiPost } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';

const keystore = {
  encryptedKey: 'abc',
  walletAddress: '0x1111111111111111111111111111111111111111',
  deviceId: 'device-1',
  apiToken: 'token-1',
  agentId: null,
};

describe('task artifact commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as any);
    vi.mocked(signMessage).mockResolvedValue('0xsig');
  });

  it('preserves the legacy single-file submission body', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('one file') as any);
    vi.mocked(apiPost).mockResolvedValue({ submissionId: 'submission-1' });

    await submitCmd.parseAsync(['node', 'submit', '0xtask', '--file', 'one.png'], {
      from: 'node',
    });

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/submissions', {
      workerAddress: keystore.walletAddress,
      file: Buffer.from('one file').toString('base64'),
      fileName: 'one.png',
      mimeType: 'image/png',
      signature: '0xsig',
    });
    expect(printResult).toHaveBeenCalledWith({ submissionId: 'submission-1' });
  });

  it('sends repeated files as artifact submissions', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(Buffer.from('png file') as any)
      .mockResolvedValueOnce(Buffer.from('svg file') as any);
    vi.mocked(apiPost).mockResolvedValue({ submissionId: 'submission-2' });

    await submitCmd.parseAsync(
      ['node', 'submit', '0xtask', '--file', 'logo.png', '--file', 'logo.svg'],
      { from: 'node' }
    );

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/submissions', {
      workerAddress: keystore.walletAddress,
      signature: '0xsig',
      artifacts: [
        {
          fileName: 'logo.png',
          mimeType: 'image/png',
          role: 'attachment',
          file: Buffer.from('png file').toString('base64'),
        },
        {
          fileName: 'logo.svg',
          mimeType: 'image/svg+xml',
          role: 'attachment',
          file: Buffer.from('svg file').toString('base64'),
        },
      ],
    });
  });

  it('passes artifact IDs to the authenticated download endpoint', async () => {
    vi.mocked(apiPost).mockResolvedValue({ presignedUrl: 'https://example.com/logo.png' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('png bytes').buffer,
      })
    );

    await downloadCmd.parseAsync(
      [
        'node',
        'download',
        '0xtask',
        '--submission',
        'submission-1',
        '--artifact',
        'artifact-1',
        '--output',
        'logo.png',
      ],
      { from: 'node' }
    );

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/submissions/submission-1/preview', {
      taskId: '0xtask',
      submissionId: 'submission-1',
      artifactId: 'artifact-1',
      deviceId: 'device-1',
      apiToken: 'token-1',
    });
    expect(writeFileSync).toHaveBeenCalledWith('logo.png', expect.any(Buffer));
  });

  it('surfaces the backend multi-artifact requirement when artifact is omitted', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('--artifact is required for this submission'));

    await expect(
      downloadCmd.parseAsync(['node', 'download', '0xtask', '--submission', 'submission-1'], {
        from: 'node',
      })
    ).rejects.toThrow('--artifact is required for this submission');
  });
});
