// Implements: ADR-0047
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeChain } from '../helpers';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

// Imported after the environment stub: the module graph reaches services/contract.ts, which
// resolves server config at import time and exits the process when it is missing.
const {
  assertEvaluatorAssignable,
  buildEvaluatorAssignment,
  completeEvaluatorAssignment,
  EvaluatorAssignmentError,
} = await import('../../../src/services/evaluator-assignment');

afterAll(restoreServerEnvironment);

const REQUESTER = '0x0000000000000000000000000000000000000001';
const WORKER = '0x0000000000000000000000000000000000000002';
const EVALUATOR = '0x0000000000000000000000000000000000000003';
const ZERO = '0x0000000000000000000000000000000000000000';

function dbReturning(rows: unknown[]) {
  return { select: vi.fn(() => makeChain(rows)) } as never;
}

function assign(overrides: Record<string, unknown> = {}, rows: unknown[] = [taskRow()]) {
  return assertEvaluatorAssignable({
    db: dbReturning(rows),
    evaluator: EVALUATOR,
    payer: REQUESTER,
    taskId: '0xtask',
    ...overrides,
  });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return { evaluator: null, requester: REQUESTER, status: 'open', ...overrides };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EvaluatorAssignmentError) return error.status;
    throw error;
  }
  throw new Error('Expected the assignment to be refused, but it was allowed');
}

describe('buildEvaluatorAssignment', () => {
  it('converts both windows from hours to the seconds the contract stores', () => {
    expect(
      buildEvaluatorAssignment({
        appealWindowHours: 2,
        evaluationWindowHours: 1.5,
        evaluator: EVALUATOR,
        evaluatorFeeBps: 250,
      })
    ).toEqual({
      appealWindow: 7200,
      disputeResolver: null,
      evaluationWindow: 5400,
      evaluator: EVALUATOR,
      evaluatorFeeBps: 250,
    });
  });

  it('defaults an omitted fee to zero and both windows to 24 hours', () => {
    expect(buildEvaluatorAssignment({ evaluator: EVALUATOR })).toEqual({
      appealWindow: 86400,
      disputeResolver: null,
      evaluationWindow: 86400,
      evaluator: EVALUATOR,
      evaluatorFeeBps: 0,
    });
  });
});

describe('assertEvaluatorAssignable', () => {
  it('allows the requester to assign to an open task with no evaluator', async () => {
    await expect(assign()).resolves.toBeUndefined();
  });

  // Mirrors EvaluatorFacet.assignEvaluator's NotRequester revert, refused before payment.
  it('refuses a payer who is not the task requester', async () => {
    expect(await statusOf(assign({ payer: WORKER }))).toBe(403);
  });

  // Mirrors TaskNotOpen. This is the gate that makes assignment un-deferrable, so it is the
  // one branch most worth pinning: a claimed task must never be assignable again.
  it('refuses a task that is no longer open', async () => {
    expect(await statusOf(assign({}, [taskRow({ status: 'claimed' })]))).toBe(400);
  });

  // Mirrors EvaluatorAlreadyAssigned. There is no reassignment path by design.
  it('refuses a task that already has an evaluator', async () => {
    expect(await statusOf(assign({}, [taskRow({ evaluator: WORKER })]))).toBe(400);
  });

  // Mirrors InvalidEvaluator: address(0) is also the "no evaluator" sentinel.
  it('refuses the zero address as evaluator', async () => {
    expect(await statusOf(assign({ evaluator: ZERO }))).toBe(400);
  });

  it('refuses a malformed evaluator or dispute resolver', async () => {
    expect(await statusOf(assign({ evaluator: 'not-an-address' }))).toBe(400);
    expect(await statusOf(assign({ disputeResolver: '0xabc' }))).toBe(400);
  });

  it('refuses an unknown task', async () => {
    expect(await statusOf(assign({}, []))).toBe(404);
  });
});

describe('completeEvaluatorAssignment', () => {
  it('writes only to a task still open', async () => {
    // Repeating fixed values is only harmless while nothing else has deliberately unset them,
    // and something has: completeEvaluationsEvaluatorTimeout clears `evaluator` and moves the
    // task to 'pending_approval' precisely because that evaluator failed to act. Unguarded, a
    // late reconciler retry restores the evaluator the timeout removed, on a task whose current
    // state exists to record their absence. The predicate has to be in the WHERE clause rather
    // than a status read in application code, which is stale the moment two passes race.
    const dialect = new PgDialect();
    const captured: { params: unknown[]; sql: string }[] = [];
    const db = {
      update: () => ({
        set: () => ({
          where: (predicate: { getSQL: () => never }) => {
            captured.push(dialect.sqlToQuery(predicate.getSQL()));
            return {
              then: (onfulfilled?: (value: undefined) => unknown) =>
                Promise.resolve(undefined).then(onfulfilled),
            };
          },
        }),
      }),
    };

    await completeEvaluatorAssignment({
      db: db as never,
      payload: {
        assignment: buildEvaluatorAssignment({ evaluator: EVALUATOR }),
        payer: REQUESTER,
        taskId: '0xtask',
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.params).toContain('0xtask');
    // 'open' is the whole allowed set: EvaluatorFacet.assignEvaluator reverts TaskNotOpen for
    // anything else, and the write leaves the status alone, so there is no result of its own
    // and no indexer-race state to widen for.
    expect(captured[0]?.params).toContain('open');
    expect(captured[0]?.params).not.toContain('pending_approval');
  });
});
