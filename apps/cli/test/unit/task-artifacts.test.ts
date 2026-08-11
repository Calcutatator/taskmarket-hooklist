import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';
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
  const request = vi
    .fn()
    .mockImplementation(
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

// /submissions/from-keys is gated by submissionAllowanceGate (RFC-0006) and can
// return a 402 payment challenge -- submit.ts uses x402Post for that call, not
// apiPost, so it's mocked separately here.
vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn((message: string) => {
    throw new Error(message);
  }),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { writeFileSync } from 'fs';
import { submitCmd } from '../../src/commands/task/submit.js';
import { downloadCmd } from '../../src/commands/task/download.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { signMessage } from '../../src/lib/signer.js';
import { apiPost } from '../../src/lib/api.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';
import { createHash } from 'crypto';
import { keccak256 } from 'viem';
import { buildSubmitMessage } from '@taskmarket/shared';

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
    vi.mocked(x402Post).mockReset();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as never);
    vi.mocked(signMessage).mockResolvedValue('0xsig');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  it('requests upload URL then calls submitFromKeys for a single file', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(writeOutcome({
      uploadUrl: 'http://localhost/upload',
      artifactKey: 'submissions/0xtask/pending/key-one.png',
    }));
    vi.mocked(x402Post).mockResolvedValueOnce(writeOutcome({ submissionId: 'submission-1' }));

    await submitCmd.parseAsync(['node', 'submit', '0xtask', '--file', 'one.png'], {
      from: 'node',
    });

    expect(apiPost).toHaveBeenNthCalledWith(1, '/api/tasks/0xtask/submissions/request-upload-url', {
      taskId: '0xtask',
      workerAddress: keystore.walletAddress,
      signature: '0xsig',
      fileName: 'one.png',
      mimeType: 'image/png',
      role: 'attachment',
      sizeBytes: 8,
    });

    expect(x402Post).toHaveBeenNthCalledWith(1, '/api/tasks/0xtask/submissions/from-keys', {
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

    expect(printResult).toHaveBeenCalledWith({ submissionId: 'submission-1' }, { idempotencyKey: TEST_IDEMPOTENCY_KEY });
  });

  it('uploads multiple files and passes all artifact keys', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce(writeOutcome({
        uploadUrl: 'http://localhost/upload1',
        artifactKey: 'key/logo.png',
      }))
      .mockResolvedValueOnce(
        writeOutcome({
          uploadUrl: 'http://localhost/upload2',
          artifactKey: 'key/logo.svg',
        })
      );
    vi.mocked(x402Post).mockResolvedValueOnce(writeOutcome({ submissionId: 'submission-2' }));

    await submitCmd.parseAsync(
      ['node', 'submit', '0xtask', '--file', 'logo.png', '--file', 'logo.svg'],
      { from: 'node' }
    );

    // 2 requestUploadUrl (apiPost) + 1 submitFromKeys (x402Post)
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(x402Post).toHaveBeenCalledTimes(1);

    const submitCall = vi.mocked(x402Post).mock.calls[0];
    expect(submitCall?.[0]).toBe('/api/tasks/0xtask/submissions/from-keys');
    const body = submitCall?.[1] as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(2);
    expect(printResult).toHaveBeenCalledWith({ submissionId: 'submission-2' }, { idempotencyKey: TEST_IDEMPOTENCY_KEY });
  });

  it('signs a second, content-bound message for the final submission distinct from the unbound upload-request signature', async () => {
    // signMessage's message argument determines the returned signature here so the
    // test can tell the two signatures apart -- the default beforeEach stub always
    // returns the same '0xsig' regardless of input, which would mask issue #323's
    // fix (the finalize call must sign a *different*, content-bound message).
    vi.mocked(signMessage).mockImplementation(async (message: string) => `0xsig-for:${message}`);
    vi.mocked(apiPost).mockResolvedValueOnce(writeOutcome({
      uploadUrl: 'http://localhost/upload',
      artifactKey: 'submissions/0xtask/pending/key-one.png',
    }));
    vi.mocked(x402Post).mockResolvedValueOnce(writeOutcome({ submissionId: 'submission-3' }));

    await submitCmd.parseAsync(['node', 'submit', '0xtask', '--file', 'one.png'], {
      from: 'node',
    });

    expect(signMessage).toHaveBeenCalledTimes(2);
    const [firstMessage] = vi.mocked(signMessage).mock.calls[0]!;
    const [secondMessage] = vi.mocked(signMessage).mock.calls[1]!;

    // requestUploadUrl runs before any artifactKey exists, so it still signs
    // today's unbound message.
    expect(firstMessage).toBe(buildSubmitMessage('0xtask'));
    // The finalize call runs after every artifactKey is known, so it signs a
    // message bound to them.
    expect(secondMessage).toBe(
      buildSubmitMessage('0xtask', ['submissions/0xtask/pending/key-one.png'])
    );
    expect(secondMessage).not.toBe(firstMessage);

    const requestUploadCall = vi.mocked(apiPost).mock.calls[0];
    const submitCall = vi.mocked(x402Post).mock.calls[0];
    const requestUploadSignature = (requestUploadCall?.[1] as { signature: string }).signature;
    const submitSignature = (submitCall?.[1] as { signature: string }).signature;

    expect(requestUploadSignature).toBe(`0xsig-for:${firstMessage}`);
    expect(submitSignature).toBe(`0xsig-for:${secondMessage}`);
    expect(submitSignature).not.toBe(requestUploadSignature);
  });

  it('passes artifact IDs to the authenticated download endpoint', async () => {
    vi.mocked(apiPost).mockResolvedValue(writeOutcome({ presignedUrl: 'https://example.com/logo.png' }));
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
