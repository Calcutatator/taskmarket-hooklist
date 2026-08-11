import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';

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
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { forfeitCmd } from '../../src/commands/task/forfeit.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { signMessage } from '../../src/lib/signer.js';
import { apiPost } from '../../src/lib/api.js';
import { printResult, renderFailure } from '../../src/lib/output.js';

const keystore = {
  encryptedKey: 'abc',
  walletAddress: '0xRequester00000000000000000000000000000099',
  deviceId: 'device-1',
  apiToken: 'token-1',
  agentId: null,
};

describe('task forfeit command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as never);
    vi.mocked(signMessage).mockResolvedValue('0xsig');
  });

  it('signs taskmarket:forfeit:<taskId> and posts the wallet-signed body', async () => {
    vi.mocked(apiPost).mockResolvedValue(writeOutcome({ txHash: '0xtxhash' }));

    await forfeitCmd.parseAsync(['node', 'forfeit', '0xtask'], { from: 'node' });

    expect(signMessage).toHaveBeenCalledWith('taskmarket:forfeit:0xtask', keystore);
    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/forfeit', {
      taskId: '0xtask',
      requesterAddress: keystore.walletAddress,
      signature: '0xsig',
    });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xtxhash' }, { idempotencyKey: TEST_IDEMPOTENCY_KEY });
  });

  it('surfaces API errors through renderFailure, with the error itself', async () => {
    const failure = new Error('Task is not currently claimed');
    vi.mocked(apiPost).mockRejectedValueOnce(failure);

    await expect(
      forfeitCmd.parseAsync(['node', 'forfeit', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Task is not currently claimed');

    // The error, not its message: passing the message is what dropped the ADR-0058 envelope.
    expect(renderFailure).toHaveBeenCalledWith(failure);
  });
});
