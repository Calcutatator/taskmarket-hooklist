import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';

const TASK_ID = `0x${'ab'.repeat(32)}`;
const PITCH_ID = 'pitch-1';
const WORKER = '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD';

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn().mockResolvedValue({ walletAddress: '0xrequester' }),
}));

vi.mock('../../src/lib/signer.js', () => ({
  signMessage: vi.fn().mockResolvedValue('0xsignature'),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiPost: vi.fn().mockResolvedValue(writeOutcome({ success: true })),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { selectWorkerCmd } from '../../src/commands/task/select-worker.js';
import { apiPost } from '../../src/lib/api.js';
import { signMessage } from '../../src/lib/signer.js';

describe('task select-worker command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs the task, pitch, and lowercase worker as one canonical message', async () => {
    await selectWorkerCmd.parseAsync(
      ['node', 'select-worker', TASK_ID, '--pitch', PITCH_ID, '--worker', WORKER],
      { from: 'node' }
    );

    expect(signMessage).toHaveBeenCalledWith(
      `taskmarket:select-worker:${TASK_ID}:${PITCH_ID}:${WORKER.toLowerCase()}`,
      expect.any(Object)
    );
    expect(apiPost).toHaveBeenCalledWith(`/api/tasks/${TASK_ID}/pitches/select`, {
      taskId: TASK_ID,
      pitchId: PITCH_ID,
      workerAddress: WORKER,
      signature: '0xsignature',
    });
  });
});
