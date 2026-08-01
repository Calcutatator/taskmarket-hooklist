// Verifies: ADR-0035
// Verifies: ADR-0037
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChain } from '../helpers';

const { paidNext, x402MiddlewareMock } = vi.hoisted(() => {
  const paidNext = vi.fn();
  return { paidNext, x402MiddlewareMock: vi.fn(() => paidNext) };
});

vi.mock('../../../src/middleware/x402', () => ({
  x402Middleware: x402MiddlewareMock,
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { submissionAllowanceGate } from '../../../src/middleware/submissionAllowanceGate';
import {
  FREE_SUBMISSION_ALLOWANCE,
  HARD_SUBMISSION_CEILING,
  STANDARD_X402_ACTION_AMOUNT,
} from '../../../src/config/payments';

const TASK_ID = '0xtask0000000000000000000000000000000001';
const WORKER = '0xWorker0000000000000000000000000000000001';

function req(overrides: Record<string, unknown> = {}) {
  return { body: { taskId: TASK_ID, workerAddress: WORKER, ...overrides } } as never;
}
function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
}

/** Typed accessor for the mocked `status`/`json` spies on a `res()` value. */
function resSpies(response: unknown) {
  return response as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

/**
 * Mock db whose first select() resolves the task's mode; every select() after that
 * (the hard-ceiling count read, then -- when reached -- the free-allowance count read,
 * both against the same real underlying count) resolves the same `priorCount`.
 */
function dbWithModeAndCount(mode: string | undefined, priorCount: number) {
  const select = vi.fn();
  select.mockReturnValueOnce(makeChain(mode ? [{ mode }] : []));
  select.mockReturnValue(makeChain([{ value: priorCount }]));
  return { select } as never;
}

describe('submissionAllowanceGate (RFC-0006 Tier 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bypasses x402 entirely under the free allowance for a bounty task', async () => {
    const db = dbWithModeAndCount('bounty', FREE_SUBMISSION_ALLOWANCE - 1);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('bypasses x402 entirely under the free allowance for a benchmark task', async () => {
    const db = dbWithModeAndCount('benchmark', 0);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('boundary: the Nth submission (prior count = N-1) is still free', async () => {
    const db = dbWithModeAndCount('bounty', FREE_SUBMISSION_ALLOWANCE - 1);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('boundary: the N+1th submission (prior count = N) runs the paid x402 path, not next() directly', async () => {
    const db = dbWithModeAndCount('bounty', FREE_SUBMISSION_ALLOWANCE);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(paidNext).toHaveBeenCalledTimes(1);
    // The gate itself never calls next() directly on the paid path -- x402Middleware
    // owns calling next() only after settlement succeeds.
    expect(next).not.toHaveBeenCalled();
  });

  it('runs the paid x402 path for submissions well past the allowance', async () => {
    const db = dbWithModeAndCount('bounty', FREE_SUBMISSION_ALLOWANCE + 50);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(paidNext).toHaveBeenCalledTimes(1);
  });

  it('claim submissions stay unmetered regardless of prior submission count', async () => {
    const db = dbWithModeAndCount('claim', 999);
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('pitch and auction submissions stay unmetered', async () => {
    for (const mode of ['pitch', 'auction']) {
      vi.clearAllMocks();
      const db = dbWithModeAndCount(mode, 999);
      const next = vi.fn();
      const gate = submissionAllowanceGate(db, { description: 'Submit work' });

      await gate(req(), res(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(paidNext).not.toHaveBeenCalled();
    }
  });

  it('fails open (unmetered) when the task lookup throws', async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error('db unavailable');
      }),
    } as never;
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('fails CLOSED (routes to the paid path) when the free-allowance check throws, unlike the task-lookup failure above', async () => {
    // First select(): task mode (bounty). Second: hard-ceiling count, succeeds, under
    // ceiling. Third: the free-allowance count read -- this is the one that throws.
    const select = vi.fn();
    select.mockReturnValueOnce(makeChain([{ mode: 'bounty' }]));
    select.mockReturnValueOnce(makeChain([{ value: 0 }]));
    select.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });
    const db = { select } as never;
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    // Fails closed to the paid path -- not next() -- since the ceiling check already
    // confirmed this submission is otherwise permitted; the only open question left is
    // free-or-paid, and the safer default on a real error is to require payment rather
    // than silently grant a free bypass.
    expect(paidNext).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('stays unmetered when the task is not found (router below handles NOT_FOUND)', async () => {
    const db = { select: vi.fn(() => makeChain([])) } as never;
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('stays unmetered when taskId or workerAddress is missing from the body', async () => {
    const mockSelect = vi.fn(() => makeChain([]));
    const db = { select: mockSelect } as never;
    const next = vi.fn();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req({ workerAddress: undefined }), res(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(paidNext).not.toHaveBeenCalled();
  });

  // RFC-0006 Tier 2 (ADR-0037): hard-ceiling checks (Testing & Verification cases 11-14 in
  // docs/specs/submission-tier-2-hard-ceiling.md).
  it('at/over the hard ceiling: responds 429 with a JSON error body, next() is never called, x402Middleware is never invoked', async () => {
    const db = dbWithModeAndCount('bounty', HARD_SUBMISSION_CEILING);
    const next = vi.fn();
    const response = res();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), response, next);

    expect(resSpies(response).status).toHaveBeenCalledWith(429);
    expect(resSpies(response).json).toHaveBeenCalledWith({
      error: 'This task has reached its maximum number of submissions from this worker.',
    });
    expect(next).not.toHaveBeenCalled();
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('above the hard ceiling: still responds 429', async () => {
    const db = dbWithModeAndCount('benchmark', HARD_SUBMISSION_CEILING + 25);
    const next = vi.fn();
    const response = res();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), response, next);

    expect(resSpies(response).status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
    expect(paidNext).not.toHaveBeenCalled();
  });

  it('under the hard ceiling but over the free allowance: still routes to x402Middleware, unchanged from Tier 1', async () => {
    const db = dbWithModeAndCount('bounty', FREE_SUBMISSION_ALLOWANCE + 10);
    const next = vi.fn();
    const response = res();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), response, next);

    expect(paidNext).toHaveBeenCalledTimes(1);
    expect(resSpies(response).status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('under the free allowance: still bypasses to next() directly, unchanged from Tier 1', async () => {
    const db = dbWithModeAndCount('bounty', 0);
    const next = vi.fn();
    const response = res();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
    expect(resSpies(response).status).not.toHaveBeenCalled();
  });

  it('non-metered task mode: still unmetered, the hard ceiling does not apply outside bounty/benchmark', async () => {
    const db = dbWithModeAndCount('claim', HARD_SUBMISSION_CEILING + 1);
    const next = vi.fn();
    const response = res();
    const gate = submissionAllowanceGate(db, { description: 'Submit work' });

    await gate(req(), response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paidNext).not.toHaveBeenCalled();
    expect(resSpies(response).status).not.toHaveBeenCalled();
  });

  it('constructs the paid path with the standard action amount and the given description', () => {
    const db = dbWithModeAndCount('bounty', 0);
    submissionAllowanceGate(db, { description: 'Submit work' });

    expect(x402MiddlewareMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Submit work' })
    );
    const calls = x402MiddlewareMock.mock.calls as unknown as Array<[{ getAmount: () => string }]>;
    const opts = calls.at(-1)?.[0];
    expect(opts?.getAmount()).toBe(STANDARD_X402_ACTION_AMOUNT);
  });
});
