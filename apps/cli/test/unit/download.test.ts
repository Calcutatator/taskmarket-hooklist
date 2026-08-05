import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn(),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiPost: vi.fn(),
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
import { downloadCmd } from '../../src/commands/task/download.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { apiPost } from '../../src/lib/api.js';
import { printError } from '../../src/lib/output.js';

const keystore = {
  encryptedKey: 'abc',
  walletAddress: '0x1111111111111111111111111111111111111111',
  deviceId: 'device-1',
  apiToken: 'token-1',
  agentId: null,
};

function stubFetchWithBytes(bytes: Buffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })
  );
}

describe('task download command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as never);
    vi.mocked(apiPost).mockResolvedValue(writeOutcome({ presignedUrl: 'https://example.com/file' } as never));
  });

  it('strips embedded ANSI/VT100 escape sequences before writing to stdout', async () => {
    const malicious = Buffer.from('\x1b[2J\x1b[Hplain text');
    stubFetchWithBytes(malicious);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await downloadCmd.parseAsync(['node', 'download', '0xtask', '--submission', 'submission-1'], {
      from: 'node',
    });

    expect(writeSpy).toHaveBeenCalled();
    const written = writeSpy.mock.calls.map(([chunk]) => chunk).join('');
    expect(written).not.toContain('\x1b');
    expect(written).toContain('plain text');
  });

  it('refuses to print binary content and points the user at --output', async () => {
    // 0xC0 0x80 is an invalid UTF-8 byte sequence (overlong encoding), guaranteed to
    // fail strict decoding.
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xc0, 0x80, 0x00, 0xff]);
    stubFetchWithBytes(binary);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(
      downloadCmd.parseAsync(['node', 'download', '0xtask', '--submission', 'submission-1'], {
        from: 'node',
      })
    ).rejects.toThrow();

    expect(printError).toHaveBeenCalledWith(expect.stringContaining('--output'));
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('writes plain UTF-8 content through unchanged', async () => {
    const plain = Buffer.from('hello world\nline two\n');
    stubFetchWithBytes(plain);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await downloadCmd.parseAsync(['node', 'download', '0xtask', '--submission', 'submission-1'], {
      from: 'node',
    });

    expect(writeSpy).toHaveBeenCalledWith('hello world\nline two\n');
  });

  it('still writes raw bytes to a file when --output is given, without sanitizing', async () => {
    const malicious = Buffer.from('\x1b[2Jclip');
    stubFetchWithBytes(malicious);

    await downloadCmd.parseAsync(
      ['node', 'download', '0xtask', '--submission', 'submission-1', '--output', 'out.bin'],
      { from: 'node' }
    );

    expect(writeFileSync).toHaveBeenCalledWith('out.bin', expect.any(Buffer));
  });
});
