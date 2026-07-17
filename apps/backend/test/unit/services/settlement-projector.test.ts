import { describe, expect, it } from 'vitest';

import { projectSettlementLogs } from '../../../src/services/settlement-projector';

const TASK_ID = `0x${'11'.repeat(32)}`;
const TX_HASH = `0x${'22'.repeat(32)}`;
const WORKER_A = '0x1111111111111111111111111111111111111111';
const WORKER_B = '0x2222222222222222222222222222222222222222';
const WORKER_C = '0x3333333333333333333333333333333333333333';

function completionLog(
  worker: string,
  workerPayment: bigint,
  platformFee: bigint,
  logIndex: number
) {
  return {
    args: { platformFee, taskId: TASK_ID, worker, workerPayment },
    blockNumber: 123n,
    logIndex,
    transactionHash: TX_HASH,
  };
}

describe('settlement projection', () => {
  it('preserves every split payout with exact amounts and the on-chain primary worker', () => {
    const groups = projectSettlementLogs(
      [
        completionLog(WORKER_C, 1_266_540n, 66_660n, 12),
        completionLog(WORKER_A, 1_266_920n, 66_680n, 10),
        completionLog(WORKER_B, 1_266_540n, 66_660n, 11),
      ],
      new Map([
        [
          TASK_ID,
          {
            primaryWorker: WORKER_A,
            verdictAwards: [],
            verdictIssued: false,
          },
        ],
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ taskId: TASK_ID, transactionHash: TX_HASH });
    expect(groups[0]?.awards).toEqual([
      expect.objectContaining({
        grossAmount: 1_333_600n,
        isPrimary: true,
        platformFee: 66_680n,
        rank: 1,
        workerAddress: WORKER_A,
        workerPayment: 1_266_920n,
      }),
      expect.objectContaining({
        grossAmount: 1_333_200n,
        isPrimary: false,
        platformFee: 66_660n,
        rank: 2,
        workerAddress: WORKER_B,
        workerPayment: 1_266_540n,
      }),
      expect.objectContaining({
        grossAmount: 1_333_200n,
        isPrimary: false,
        platformFee: 66_660n,
        rank: 3,
        workerAddress: WORKER_C,
        workerPayment: 1_266_540n,
      }),
    ]);
  });

  it('uses stored evaluator ranks when the verdict matches emitted payouts', () => {
    const groups = projectSettlementLogs(
      [completionLog(WORKER_A, 760n, 40n, 20), completionLog(WORKER_B, 190n, 10n, 21)],
      new Map([
        [
          TASK_ID,
          {
            primaryWorker: WORKER_A,
            verdictAwards: [
              { amount: 800n, rank: 7, worker: WORKER_A },
              { amount: 200n, rank: 9, worker: WORKER_B },
            ],
            verdictIssued: true,
          },
        ],
      ])
    );

    expect(groups[0]?.awards.map((award) => award.rank)).toEqual([7, 9]);
  });

  it('resets direct-acceptance rank for each task and transaction', () => {
    const secondTaskId = `0x${'44'.repeat(32)}`;
    const groups = projectSettlementLogs(
      [
        completionLog(WORKER_A, 95n, 5n, 1),
        {
          ...completionLog(WORKER_B, 190n, 10n, 2),
          args: {
            ...completionLog(WORKER_B, 190n, 10n, 2).args,
            taskId: secondTaskId,
          },
        },
      ],
      new Map()
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.awards[0]?.rank)).toEqual([1, 1]);
  });

  it('marks only the first award row when the primary worker receives multiple awards', () => {
    const [settlement] = projectSettlementLogs(
      [completionLog(WORKER_A, 570n, 30n, 10), completionLog(WORKER_A, 380n, 20n, 11)],
      new Map([
        [
          TASK_ID,
          {
            primaryWorker: WORKER_A,
            verdictAwards: [
              { amount: 600n, rank: 1, worker: WORKER_A },
              { amount: 400n, rank: 2, worker: WORKER_A },
            ],
            verdictIssued: true,
          },
        ],
      ])
    );

    expect(settlement?.awards.map((award) => award.isPrimary)).toEqual([true, false]);
  });
});
