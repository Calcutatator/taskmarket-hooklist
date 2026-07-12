import { describe, expect, it } from 'vitest';
import {
  computeNetReward,
  computePendingActions,
  computeSubmissionWindowOpen,
  normalizeRequesterPublicKey,
  type PendingActionTask,
} from '../../../src/lib/task';

const NOW = new Date('2026-07-11T00:00:00.000Z');
const FUTURE = new Date('2026-07-12T00:00:00.000Z');
const PAST = new Date('2026-07-10T00:00:00.000Z');
const REQUESTER = '0x0000000000000000000000000000000000000001';
const WORKER = '0x0000000000000000000000000000000000000002';

function task(overrides: Partial<PendingActionTask> = {}): PendingActionTask {
  return {
    id: `0x${'ab'.repeat(32)}`,
    requester: REQUESTER,
    status: 'open',
    mode: 'bounty',
    rating: null,
    pitchCount: 0,
    bidCount: 0,
    submissionCount: 0,
    expiryTime: FUTURE,
    pitchDeadline: null,
    bidDeadline: null,
    claimedBy: null,
    worker: null,
    auctionType: null,
    currentClockPrice: null,
    currentLowestBid: null,
    ...overrides,
  };
}

describe('computeSubmissionWindowOpen', () => {
  it.each([
    ['bounty', 'open'],
    ['benchmark', 'open'],
    ['claim', 'claimed'],
    ['pitch', 'worker_selected'],
    ['auction', 'claimed'],
  ])('opens %s delivery in %s', (mode, status) => {
    expect(computeSubmissionWindowOpen(task({ mode, status }), NOW)).toBe(true);
  });

  it.each([
    ['claim', 'open'],
    ['pitch', 'open'],
    ['auction', 'open'],
    ['bounty', 'claimed'],
    ['benchmark', 'pending_approval'],
  ])('does not treat %s status %s as a delivery window', (mode, status) => {
    expect(computeSubmissionWindowOpen(task({ mode, status }), NOW)).toBe(false);
  });

  it('closes every mode at task expiry', () => {
    expect(computeSubmissionWindowOpen(task({ expiryTime: NOW }), NOW)).toBe(false);
    expect(computeSubmissionWindowOpen(task({ status: 'claimed', mode: 'claim', expiryTime: PAST }), NOW)).toBe(
      false
    );
  });
});

describe('computePendingActions', () => {
  it('blocks contest cancellation while active submissions exist', () => {
    const actions = computePendingActions(
      task({ submissionCount: 2, latestSubmissionWorker: WORKER }),
      NOW
    );

    expect(actions.some((candidate) => candidate.action === 'cancel')).toBe(false);
    expect(actions.some((candidate) => candidate.action === 'accept')).toBe(true);
    expect(actions.some((candidate) => candidate.action === 'accept_submissions')).toBe(true);
    expect(actions.some((candidate) => candidate.action === 'reject_submission')).toBe(true);
  });

  it('routes evaluator-backed contest decisions to the evaluator', () => {
    const actions = computePendingActions(
      task({ submissionCount: 1, latestSubmissionWorker: WORKER, evaluator: WORKER }),
      NOW
    );

    expect(actions.some((candidate) => candidate.action === 'accept')).toBe(false);
    expect(actions.some((candidate) => candidate.action === 'accept_submissions')).toBe(false);
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: 'evaluate',
        eligibleAddress: WORKER,
        requiresPayment: true,
        paymentAmount: '1000',
      })
    );
    expect(actions.find((candidate) => candidate.action === 'evaluate')?.command).toContain(
      '--award'
    );
  });

  it('offers submit only to the claimed worker before expiry', () => {
    const actions = computePendingActions(
      task({ mode: 'claim', status: 'claimed', claimedBy: WORKER }),
      NOW
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: 'submit',
      eligibleAddress: WORKER,
      requiresPayment: false,
      paymentAmount: null,
      availableUntil: FUTURE.toISOString(),
    });
  });

  it('offers forfeit only after claim expiry', () => {
    const before = computePendingActions(
      task({ mode: 'claim', status: 'claimed', claimedBy: WORKER }),
      NOW
    );
    const after = computePendingActions(
      task({ mode: 'claim', status: 'claimed', claimedBy: WORKER, expiryTime: PAST }),
      NOW
    );

    expect(before.some((candidate) => candidate.action === 'forfeit')).toBe(false);
    expect(after).toEqual([
      expect.objectContaining({
        action: 'forfeit',
        eligibleAddress: REQUESTER,
        availableAfter: PAST.toISOString(),
      }),
    ]);
  });

  it('marks paid actions with the standard base-unit amount', () => {
    const actions = computePendingActions(task(), NOW);
    const cancel = actions.find((candidate) => candidate.action === 'cancel');
    const claim = computePendingActions(task({ mode: 'claim' }), NOW).find(
      (candidate) => candidate.action === 'claim'
    );

    expect(cancel).toMatchObject({
      eligibleAddress: REQUESTER,
      requiresPayment: true,
      paymentAmount: '1000',
    });
    expect(claim).toMatchObject({ requiresPayment: false, paymentAmount: null });

    const pitch = computePendingActions(
      task({ mode: 'pitch', pitchDeadline: FUTURE }),
      NOW
    ).find((candidate) => candidate.action === 'pitch');
    expect(pitch).toMatchObject({ requiresPayment: true, paymentAmount: '1000' });
  });

  it('returns an executable dispute template and resolver eligibility', () => {
    const [resolve] = computePendingActions(
      task({ status: 'disputed', disputeResolver: WORKER }),
      NOW
    );

    expect(resolve.eligibleAddress).toBe(WORKER);
    expect(resolve.command).toContain('--award <worker>:<amount-usdc>:<rank>');
  });

  it('offers refund and extension after an empty open task expires', () => {
    const actions = computePendingActions(task({ expiryTime: PAST }), NOW);

    expect(actions.map((candidate) => candidate.action)).toEqual(['update', 'refund_expired']);
  });

  it('marks deterministic auction finalization as permissionless and free', () => {
    const actions = computePendingActions(
      task({
        mode: 'auction',
        auctionType: 'english',
        bidCount: 1,
        bidDeadline: PAST,
      }),
      NOW
    );

    expect(actions).toEqual([
      expect.objectContaining({
        action: 'select_winner',
        role: 'anyone',
        eligibleAddress: null,
        requiresPayment: false,
      }),
    ]);
  });

  it('formats auction prices without losing bigint precision', () => {
    const clock = computePendingActions(
      task({
        mode: 'auction',
        auctionType: 'dutch',
        bidDeadline: FUTURE,
        currentClockPrice: 9_007_199_254_740_993_123_456n,
      }),
      NOW
    );
    const english = computePendingActions(
      task({
        mode: 'auction',
        auctionType: 'english',
        bidDeadline: FUTURE,
        currentLowestBid: '9007199254740993123456',
      }),
      NOW
    );

    expect(clock.find((candidate) => candidate.action === 'auction_accept')?.command).toContain(
      '$9007199254740993.123456'
    );
    expect(english.find((candidate) => candidate.action === 'bid')?.command).toContain(
      '$9007199254740993.123456'
    );
  });

  it('offers requester refund for an expired locked-worker approval', () => {
    const actions = computePendingActions(
      task({
        mode: 'claim',
        status: 'pending_approval',
        worker: WORKER,
        submissionCount: 1,
        expiryTime: PAST,
      }),
      NOW
    );

    expect(actions).toEqual([
      expect.objectContaining({
        action: 'refund_expired',
        eligibleAddress: REQUESTER,
      }),
    ]);
  });
});

describe('computeNetReward', () => {
  it('uses integer arithmetic', () => {
    expect(computeNetReward('3000000', 500)).toBe('2850000');
    expect(computeNetReward('999999999999999999999999999999', 500)).toBe(
      '949999999999999999999999999999'
    );
  });

  it('returns null while gross payout is unknown', () => {
    expect(computeNetReward(null, 500)).toBeNull();
  });
});

describe('normalizeRequesterPublicKey', () => {
  const compressed = `02${'ab'.repeat(32)}`;
  const uncompressed = `04${'cd'.repeat(64)}`;

  it('prefers the current published key', () => {
    expect(normalizeRequesterPublicKey(compressed, uncompressed)).toBe(compressed);
  });

  it('rejects Ethereum addresses stored by legacy task creation', () => {
    expect(normalizeRequesterPublicKey(null, REQUESTER)).toBeNull();
  });
});
