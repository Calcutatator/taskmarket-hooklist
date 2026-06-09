import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const FILE_BYTES = Buffer.from('one file');

function makeStream() {
  const emitter = new EventEmitter() as NodeJS.ReadableStream & {
    pipe: ReturnType<typeof vi.fn>;
  };
  emitter.pipe = vi.fn().mockImplementation((dest: unknown) => {
    setImmediate(() => {
      emitter.emit('data', FILE_BYTES);
      emitter.emit('end');
    });
    return dest;
  });
  return emitter;
}

vi.mock('fs', () => ({
  statSync: vi.fn().mockReturnValue({ size: 8 }),
  createReadStream: vi.fn().mockImplementation(() => makeStream()),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('one file')),
  writeFileSync: vi.fn(),
  promises: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('one file')),
  },
}));

function makeHttpTransport() {
  const request = vi.fn().mockImplementation(
    (
      _url: unknown,
      _opts: unknown,
      callback?: (res: { statusCode: number; on: ReturnType<typeof vi.fn> }) => void
    ) => {
      const req = {
        on: vi.fn().mockReturnThis(),
        once: vi.fn().mockReturnThis(),
        emit: vi.fn().mockReturnThis(),
        end: vi.fn(),
        write: vi.fn().mockReturnValue(true),
        removeListener: vi.fn().mockReturnThis(),
      };
      if (callback) {
        const res = {
          statusCode: 200,
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            if (event === 'end') setImmediate(handler);
            return res;
          }),
        };
        setImmediate(() => callback(res));
      }
      return req;
    }
  );
  return { default: { request } };
}

vi.mock('https', () => makeHttpTransport());
vi.mock('http', () => makeHttpTransport());

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

import { writeFileSync } from 'fs';
import { submitCmd } from '../../src/commands/task/submit.js';
import { downloadCmd } from '../../src/commands/task/download.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { signMessage } from '../../src/lib/signer.js';
import { apiPost } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';
import { createHash } from 'crypto';
import { keccak256 } from 'viem';

const EXPECTED_SHA256 = createHash('sha256').update(FILE_BYTES).digest('hex');
const EXPECTED_KECCAK256 = keccak256(new Uint8Array(FILE_BYTES)) as string;

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
    vi.mocked(apiPost).mockReset();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as never);
    vi.mocked(signMessage).mockResolvedValue('0xsig');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  it('requests upload URL then calls submitFromKeys for a single file', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({
        uploadUrl: 'http://localhost/upload',
        artifactKey: 'submissions/0xtask/pending/key-one.png',
      })
      .mockResolvedValueOnce({ submissionId: 'submission-1' });

    await submitCmd.parseAsync(['node', 'submit', '0xtask', '--file', 'one.png'], {
      from: 'node',
    });

    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/tasks/0xtask/submissions/request-upload-url',
      {
        taskId: '0xtask',
        workerAddress: keystore.walletAddress,
        signature: '0xsig',
        fileName: 'one.png',
        mimeType: 'image/png',
        role: 'attachment',
        sizeBytes: 8,
      }
    );

    expect(apiPost).toHaveBeenNthCalledWith(2, '/api/tasks/0xtask/submissions/from-keys', {
      taskId: '0xtask',
      workerAddress: keystore.walletAddress,
      artifacts: [
        {
          artifactKey: 'submissions/0xtask/pending/key-one.png',
          fileName: 'one.png',
          mimeType: 'image/png',
          role: 'attachment',
          sizeBytes: 8,
          sha256Hash: EXPECTED_SHA256,
          keccak256Hash: EXPECTED_KECCAK256,
        },
      ],
      signature: '0xsig',
    });

    expect(printResult).toHaveBeenCalledWith({ submissionId: 'submission-1' });
  });

  it('uploads multiple files and passes all artifact keys', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({
        uploadUrl: 'http://localhost/upload1',
        artifactKey: 'key/logo.png',
      })
      .mockResolvedValueOnce({
        uploadUrl: 'http://localhost/upload2',
        artifactKey: 'key/logo.svg',
      })
      .mockResolvedValueOnce({ submissionId: 'submission-2' });

    await submitCmd.parseAsync(
      ['node', 'submit', '0xtask', '--file', 'logo.png', '--file', 'logo.svg'],
      { from: 'node' }
    );

    // 2 requestUploadUrl + 1 submitFromKeys
    expect(apiPost).toHaveBeenCalledTimes(3);

    const submitCall = vi.mocked(apiPost).mock.calls[2];
    expect(submitCall?.[0]).toBe('/api/tasks/0xtask/submissions/from-keys');
    const body = submitCall?.[1] as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(2);
    expect(printResult).toHaveBeenCalledWith({ submissionId: 'submission-2' });
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
