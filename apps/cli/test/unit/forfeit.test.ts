import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { forfeitCmd } from '../../src/commands/task/forfeit.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { signMessage } from '../../src/lib/signer.js';
import { apiPost } from '../../src/lib/api.js';
import { printResult, printError } from '../../src/lib/output.js';

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
    vi.mocked(apiPost).mockResolvedValue({ txHash: '0xtxhash' });

    await forfeitCmd.parseAsync(['node', 'forfeit', '0xtask'], { from: 'node' });

    expect(signMessage).toHaveBeenCalledWith('taskmarket:forfeit:0xtask', keystore);
    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/forfeit', {
      taskId: '0xtask',
      requesterAddress: keystore.walletAddress,
      signature: '0xsig',
    });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xtxhash' });
  });

  it('surfaces API errors via printError', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Task is not currently claimed'));

    await expect(
      forfeitCmd.parseAsync(['node', 'forfeit', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Task is not currently claimed');

    expect(printError).toHaveBeenCalledWith('Task is not currently claimed');
  });
});
