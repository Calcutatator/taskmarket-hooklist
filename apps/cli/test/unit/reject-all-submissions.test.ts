import { describe, expect, it } from 'vitest';
import { activeSubmissionWorkers } from '../../src/commands/task/reject-all-submissions.js';

describe('activeSubmissionWorkers', () => {
  it('returns unique active workers and ignores rejected submissions', () => {
    expect(
      activeSubmissionWorkers([
        { workerAddress: '0xAbC', rejectedAt: null },
        { workerAddress: '0xabc' },
        { workerAddress: '0xDef', rejectedAt: '2026-07-11T00:00:00.000Z' },
        { workerAddress: '0x123', rejectedAt: null },
      ])
    ).toEqual(['0xAbC', '0x123']);
  });
});
