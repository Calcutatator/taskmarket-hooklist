import { describe, expect, it } from 'vitest';
import { canView, type CanViewTask } from '../../../src/lib/task-visibility';

const REQUESTER = '0xRequester00000000000000000000000000000001';
const CLAIMED_WORKER = '0xClaimed0000000000000000000000000000000001';
const AWARDED_WORKER = '0xAwarded0000000000000000000000000000000001';
const ALLOWED_VIEWER = '0xAllowed0000000000000000000000000000000001';
const EVALUATOR = '0xEvaluator00000000000000000000000000000001';
const DISPUTE_RESOLVER = '0xResolver000000000000000000000000000000001';
const OUTSIDER = '0xOutsider000000000000000000000000000000001';
const TASK_ID = 'task-1';

function makeTask(overrides: Partial<CanViewTask> = {}): CanViewTask {
  return {
    id: TASK_ID,
    taskVisibility: 'public',
    requester: REQUESTER,
    claimedBy: null,
    evaluator: null,
    disputeResolver: null,
    ...overrides,
  };
}

// Verifies: ADR-0030
// Verifies: ADR-0042
describe('canView', () => {
  describe('public / unlisted tasks', () => {
    it('public task is viewable by anyone, including an unauthenticated caller', () => {
      expect(canView(makeTask({ taskVisibility: 'public' }), undefined)).toBe(true);
      expect(canView(makeTask({ taskVisibility: 'public' }), { address: OUTSIDER })).toBe(true);
    });

    it('unlisted task is viewable by anyone via direct fetch -- only discovery is gated (Phase 1)', () => {
      expect(canView(makeTask({ taskVisibility: 'unlisted' }), undefined)).toBe(true);
      expect(canView(makeTask({ taskVisibility: 'unlisted' }), { address: OUTSIDER })).toBe(true);
    });
  });

  describe('private tasks', () => {
    const privateTask = makeTask({ taskVisibility: 'private', claimedBy: CLAIMED_WORKER });

    it('is not viewable by an unauthenticated caller with no grant', () => {
      expect(canView(privateTask, undefined)).toBe(false);
    });

    it('is not viewable by an authenticated but unrelated caller', () => {
      expect(canView(privateTask, { address: OUTSIDER })).toBe(false);
    });

    it('is viewable by the requester', () => {
      expect(canView(privateTask, { address: REQUESTER })).toBe(true);
      // Case-insensitive, matching the rest of this codebase's address handling.
      expect(canView(privateTask, { address: REQUESTER.toUpperCase() })).toBe(true);
    });

    it('is viewable by the claimedBy (pre-completion) assignee', () => {
      expect(canView(privateTask, { address: CLAIMED_WORKER })).toBe(true);
    });

    it('is viewable by the currently assigned evaluator', () => {
      expect(
        canView(
          { ...privateTask, evaluator: EVALUATOR },
          { address: EVALUATOR.toUpperCase() }
        )
      ).toBe(true);
    });

    it('is viewable by the currently assigned dispute resolver', () => {
      expect(
        canView(
          { ...privateTask, disputeResolver: DISPUTE_RESOLVER },
          { address: DISPUTE_RESOLVER.toUpperCase() }
        )
      ).toBe(true);
    });

    it('revokes role-derived access when the role is cleared', () => {
      expect(canView({ ...privateTask, evaluator: null }, { address: EVALUATOR })).toBe(false);
      expect(
        canView({ ...privateTask, disputeResolver: null }, { address: DISPUTE_RESOLVER })
      ).toBe(false);
    });

    it('is viewable by an awarded (post-completion) worker via awardedWorkerAddresses', () => {
      expect(
        canView(privateTask, { address: AWARDED_WORKER }, {
          awardedWorkerAddresses: new Set([AWARDED_WORKER.toLowerCase()]),
        })
      ).toBe(true);
    });

    it('is not viewable by a worker awarded on a DIFFERENT task', () => {
      expect(
        canView(privateTask, { address: OUTSIDER }, {
          awardedWorkerAddresses: new Set([AWARDED_WORKER.toLowerCase()]),
        })
      ).toBe(false);
    });

    it('is viewable by an allowlisted wallet', () => {
      expect(
        canView(privateTask, { address: ALLOWED_VIEWER }, {
          allowedViewerAddresses: new Set([ALLOWED_VIEWER.toLowerCase()]),
        })
      ).toBe(true);
    });

    it('is not viewable by a wallet not on the allowlist', () => {
      expect(
        canView(privateTask, { address: OUTSIDER }, {
          allowedViewerAddresses: new Set([ALLOWED_VIEWER.toLowerCase()]),
        })
      ).toBe(false);
    });

    it('is viewable via a valid task-scoped access grant, even with no wallet caller at all', () => {
      expect(
        canView(privateTask, undefined, { taskAccessGrant: { taskId: TASK_ID } })
      ).toBe(true);
    });

    it('a grant scoped to a DIFFERENT task does not unlock this one', () => {
      expect(
        canView(privateTask, undefined, { taskAccessGrant: { taskId: 'some-other-task' } })
      ).toBe(false);
    });

    it('an authenticated caller with no matching entitlement and no grant is still denied', () => {
      expect(
        canView(privateTask, { address: OUTSIDER }, {
          allowedViewerAddresses: new Set([ALLOWED_VIEWER.toLowerCase()]),
          awardedWorkerAddresses: new Set([AWARDED_WORKER.toLowerCase()]),
          taskAccessGrant: { taskId: 'some-other-task' },
        })
      ).toBe(false);
    });

    it('combines multiple entitlements correctly -- any one of them is sufficient', () => {
      const context = {
        allowedViewerAddresses: new Set([ALLOWED_VIEWER.toLowerCase()]),
        awardedWorkerAddresses: new Set([AWARDED_WORKER.toLowerCase()]),
      };
      expect(canView(privateTask, { address: ALLOWED_VIEWER }, context)).toBe(true);
      expect(canView(privateTask, { address: AWARDED_WORKER }, context)).toBe(true);
      expect(canView(privateTask, { address: CLAIMED_WORKER }, context)).toBe(true);
      expect(canView(privateTask, { address: REQUESTER }, context)).toBe(true);
      expect(canView(privateTask, { address: OUTSIDER }, context)).toBe(false);
    });
  });
});
