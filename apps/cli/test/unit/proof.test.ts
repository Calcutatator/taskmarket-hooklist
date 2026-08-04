import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn().mockResolvedValue({ walletAddress: '0xworker' }),
}));

vi.mock('../../src/lib/signer.js', () => ({
  signMessage: vi.fn().mockResolvedValue('0xsignature'),
}));

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn().mockResolvedValue({ proofId: 'proof-1', submissionId: 'submission-1' }),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { proofCmd } from '../../src/commands/task/proof.js';
import { printResult } from '../../src/lib/output.js';

describe('task proof command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prints both the proof and acceptable submission IDs', async () => {
    await proofCmd.parseAsync(['node', 'proof', '0xtask', '--data', '{}', '--type', 'manual'], {
      from: 'node',
    });

    expect(printResult).toHaveBeenCalledWith({
      proofId: 'proof-1',
      submissionId: 'submission-1',
    });
  });
});
