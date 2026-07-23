import { describe, expect, it } from 'vitest';
import {
  canViewSubmission,
  isRequester,
  isSubmittingWorker,
  isTaskEnded,
  type SubmissionVisibilityMode,
} from '../../../src/lib/submission-visibility';

const REQUESTER = '0xRequester00000000000000000000000000000001';
const WORKER = '0xWorker0000000000000000000000000000000001';
const OTHER_WORKER = '0xWorker0000000000000000000000000000000002';
const task = { requester: REQUESTER };
const submission = { workerAddress: WORKER };

describe('isTaskEnded', () => {
  it('treats completed and expired as ended', () => {
    expect(isTaskEnded('completed')).toBe(true);
    expect(isTaskEnded('expired')).toBe(true);
  });

  it('treats every other status as active, including a plain cancel', () => {
    for (const status of ['open', 'claimed', 'worker_selected', 'pending_approval', 'cancelled']) {
      expect(isTaskEnded(status)).toBe(false);
    }
  });

  it('treats cancelled as active when there is no REJECT verdict (plain requester cancel)', () => {
    expect(isTaskEnded('cancelled', null)).toBe(false);
    expect(isTaskEnded('cancelled', undefined)).toBe(false);
    expect(isTaskEnded('cancelled', 'APPROVE')).toBe(false);
  });

  it('treats cancelled as ended when finalizeVerdict rejected the task (evaluations.router.ts)', () => {
    // finalizeVerdict's REJECT branch sets status to 'cancelled' but never
    // clears verdictType -- this is the only signal that distinguishes a
    // genuinely resolved (post-evaluator/appeal) cancellation from the plain
    // cancelTask path, which only ever succeeds with zero active submissions.
    expect(isTaskEnded('cancelled', 'REJECT')).toBe(true);
  });
});

describe('isRequester', () => {
  it('matches case-insensitively', () => {
    expect(isRequester({ address: REQUESTER.toUpperCase() }, task)).toBe(true);
  });

  it('is false with no caller', () => {
    expect(isRequester(undefined, task)).toBe(false);
  });

  it('is false for a non-matching caller', () => {
    expect(isRequester({ address: WORKER }, task)).toBe(false);
  });
});

describe('isSubmittingWorker', () => {
  it('matches case-insensitively', () => {
    expect(isSubmittingWorker({ address: WORKER.toLowerCase() }, submission)).toBe(true);
  });

  it('is false with no caller', () => {
    expect(isSubmittingWorker(undefined, submission)).toBe(false);
  });

  it('is false for a different worker', () => {
    expect(isSubmittingWorker({ address: OTHER_WORKER }, submission)).toBe(false);
  });
});

describe('canViewSubmission', () => {
  const winningAddresses = new Set([WORKER.toLowerCase()]);
  const noWinners = new Set<string>();

  it('public mode is always visible, any caller, any state', () => {
    for (const taskStatus of ['open', 'completed']) {
      for (const caller of [undefined, { address: OTHER_WORKER }]) {
        expect(
          canViewSubmission({
            mode: 'public',
            taskStatus,
            caller,
            task,
            submission,
            winningAddresses: noWinners,
          })
        ).toBe(true);
      }
    }
  });

  const nonPublicModes: SubmissionVisibilityMode[] = ['reveal_all', 'winner_only', 'never'];

  describe('active task (not yet ended)', () => {
    for (const mode of nonPublicModes) {
      it(`${mode}: requester sees it`, () => {
        expect(
          canViewSubmission({
            mode,
            taskStatus: 'open',
            caller: { address: REQUESTER },
            task,
            submission,
            winningAddresses,
          })
        ).toBe(true);
      });

      it(`${mode}: submitting worker sees their own`, () => {
        expect(
          canViewSubmission({
            mode,
            taskStatus: 'claimed',
            caller: { address: WORKER },
            task,
            submission,
            winningAddresses,
          })
        ).toBe(true);
      });

      it(`${mode}: another worker sees nothing`, () => {
        expect(
          canViewSubmission({
            mode,
            taskStatus: 'open',
            caller: { address: OTHER_WORKER },
            task,
            submission,
            winningAddresses,
          })
        ).toBe(false);
      });

      it(`${mode}: an unauthenticated caller sees nothing`, () => {
        expect(
          canViewSubmission({
            mode,
            taskStatus: 'open',
            caller: undefined,
            task,
            submission,
            winningAddresses,
          })
        ).toBe(false);
      });
    }
  });

  describe('ended task (completed/expired)', () => {
    it('reveal_all shows everything to anyone once ended', () => {
      expect(
        canViewSubmission({
          mode: 'reveal_all',
          taskStatus: 'completed',
          caller: { address: OTHER_WORKER },
          task,
          submission,
          winningAddresses: noWinners,
        })
      ).toBe(true);
    });

    it('reveal_all shows everything to an unauthenticated caller once ended', () => {
      expect(
        canViewSubmission({
          mode: 'reveal_all',
          taskStatus: 'expired',
          caller: undefined,
          task,
          submission,
          winningAddresses: noWinners,
        })
      ).toBe(true);
    });

    it('winner_only reveals a task_awards-linked winner to anyone once ended', () => {
      expect(
        canViewSubmission({
          mode: 'winner_only',
          taskStatus: 'completed',
          caller: { address: OTHER_WORKER },
          task,
          submission,
          winningAddresses,
        })
      ).toBe(true);
    });

    it('winner_only hides a non-winning submission from anyone but requester/self', () => {
      expect(
        canViewSubmission({
          mode: 'winner_only',
          taskStatus: 'completed',
          caller: { address: OTHER_WORKER },
          task,
          submission,
          winningAddresses: noWinners,
        })
      ).toBe(false);
    });

    it('winner_only still lets the requester see a non-winning submission', () => {
      expect(
        canViewSubmission({
          mode: 'winner_only',
          taskStatus: 'completed',
          caller: { address: REQUESTER },
          task,
          submission,
          winningAddresses: noWinners,
        })
      ).toBe(true);
    });

    it('never never reveals to anyone but the requester or submitting worker', () => {
      expect(
        canViewSubmission({
          mode: 'never',
          taskStatus: 'completed',
          caller: { address: OTHER_WORKER },
          task,
          submission,
          winningAddresses,
        })
      ).toBe(false);
    });

    it('never still lets the submitting worker see their own after the task ends', () => {
      expect(
        canViewSubmission({
          mode: 'never',
          taskStatus: 'expired',
          caller: { address: WORKER },
          task,
          submission,
          winningAddresses: noWinners,
        })
      ).toBe(true);
    });
  });

  it('a plain (non-verdict) cancel stays in the active (role-gated) view forever, never reveal', () => {
    expect(
      canViewSubmission({
        mode: 'reveal_all',
        taskStatus: 'cancelled',
        caller: { address: OTHER_WORKER },
        task,
        submission,
        winningAddresses: noWinners,
      })
    ).toBe(false);
  });

  it('a REJECT-verdict cancel (finalizeVerdict) counts as ended -- reveal_all reveals it', () => {
    expect(
      canViewSubmission({
        mode: 'reveal_all',
        taskStatus: 'cancelled',
        taskVerdictType: 'REJECT',
        caller: { address: OTHER_WORKER },
        task,
        submission,
        winningAddresses: noWinners,
      })
    ).toBe(true);
  });

  it('a REJECT-verdict cancel under never mode still stays hidden from third parties', () => {
    expect(
      canViewSubmission({
        mode: 'never',
        taskStatus: 'cancelled',
        taskVerdictType: 'REJECT',
        caller: { address: OTHER_WORKER },
        task,
        submission,
        winningAddresses: noWinners,
      })
    ).toBe(false);
  });
});
