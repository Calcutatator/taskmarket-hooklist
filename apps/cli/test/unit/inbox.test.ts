import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above top-level const declarations, so the
// address is a literal here (not the ADDRESS const below) to avoid a TDZ
// ReferenceError.
vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xRequester0000000000000000000000000000001' }),
}));

vi.mock('../../src/lib/signer.js', () => ({
  signMessage: vi.fn().mockResolvedValue('0xsignature'),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn().mockResolvedValue({ asRequester: [], asWorker: [] }),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(() => {
    throw new Error('printError called');
  }),
}));

import { inboxCommand } from '../../src/commands/inbox.js';
import { apiGet } from '../../src/lib/api.js';
import { signMessage } from '../../src/lib/signer.js';
import { printResult } from '../../src/lib/output.js';

const ADDRESS = '0xRequester0000000000000000000000000000001';

describe('inbox command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs the canonical self-auth message and includes it in the inbox request', async () => {
    vi.mocked(apiGet).mockResolvedValue({ asRequester: [], asWorker: [] });

    await inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' });

    expect(signMessage).toHaveBeenCalledWith(
      `taskmarket:inbox:${ADDRESS}`,
      expect.any(Object)
    );
    const [inboxUrl] = vi.mocked(apiGet).mock.calls[0];
    expect(inboxUrl).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(inboxUrl).toContain('signature=0xsignature');
  });

  it('falls back to an unsigned request when signing fails, without erroring', async () => {
    vi.mocked(signMessage).mockRejectedValueOnce(new Error('no device auth'));
    vi.mocked(apiGet).mockResolvedValue({ asRequester: [], asWorker: [] });

    await inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' });

    const [inboxUrl] = vi.mocked(apiGet).mock.calls[0];
    expect(inboxUrl).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(inboxUrl).not.toContain('signature=');
    expect(printResult).toHaveBeenCalled();
  });
});
