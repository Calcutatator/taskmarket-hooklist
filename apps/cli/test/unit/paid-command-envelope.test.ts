// Verifies: ADR-0058
//
// The five paid commands that used to catch their own failures and print `err.message`, checked
// end to end through the real renderer rather than through a double. What is being asserted is
// the thing a script actually reads off stderr: `reason` and `pending`, on exactly the commands
// where getting it wrong means paying for the same write twice.
//
// `renderFailure` returns rather than exiting, so the process can flush the envelope to a pipe
// before it dies. That makes "the command stopped where it reported" a property worth asserting
// rather than one the runtime enforces: each case below checks that nothing ran past the failure
// (exactly one envelope on stderr, no follow-on call) and that the exit status is still 1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInFlightApiError } from '@taskmarket/shared';

import { ApiError } from '../../src/lib/api.js';

// Hoisted because `vi.mock` factories are lifted above the module body.
const { mockX402Post, mockApiGet } = vi.hoisted(() => ({
  mockX402Post: vi.fn(),
  mockApiGet: vi.fn(),
}));

vi.mock('../../src/lib/x402.js', () => ({ x402Post: mockX402Post }));
vi.mock('../../src/lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/api.js')>('../../src/lib/api.js');
  return { ...actual, apiGet: mockApiGet };
});

const TASK = '0x1111111111111111111111111111111111111111111111111111111111111111';
const WORKER = '0x2222222222222222222222222222222222222222';

/** An in-flight failure exactly as the transport builds it from a backend 409. */
function inFlightError(): ApiError {
  return new ApiError(409, 'POST failed after payment (409): still landing', 'key-abc', {
    reason: 'intent_in_flight',
    intentId: 'intent_123',
    intentStatus: 'broadcast',
    operation: 'tasks.rejectSubmission',
    txHash: '0xdeadbeef',
  });
}

/** A settled refusal: the write definitively did not happen, so re-running it is safe. */
function rejectedError(): ApiError {
  return new ApiError(400, 'POST failed (400): task is not expired', 'key-def', {
    reason: 'payment_preflight_rejected',
  });
}

let stderr: string[];

beforeEach(() => {
  stderr = [];
  vi.clearAllMocks();
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** The single JSON envelope the command wrote to stderr. */
function envelope(): Record<string, unknown> {
  expect(stderr).toHaveLength(1);
  return JSON.parse(stderr[0]) as Record<string, unknown>;
}

async function run(
  command: { parseAsync: (argv: string[], opts: object) => Promise<unknown> },
  argv: string[]
) {
  await command.parseAsync(['node', ...argv], { from: 'node' });
  // The status the shell sees. It is set rather than exited on so that a piped stderr has time to
  // drain, which is the whole reason a failing command now returns at all.
  expect(process.exitCode).toBe(1);
}

describe('a paid command surfaces the failure classification a script branches on', () => {
  it('refund-expired reports pending on an in-flight write', async () => {
    mockX402Post.mockRejectedValueOnce(inFlightError());
    const { refundExpiredCmd } = await import('../../src/commands/task/refund-expired.js');

    await run(refundExpiredCmd, ['refund-expired', TASK]);

    expect(envelope()).toMatchObject({
      ok: false,
      status: 409,
      reason: 'intent_in_flight',
      intentId: 'intent_123',
      intentStatus: 'broadcast',
      txHash: '0xdeadbeef',
      idempotencyKey: 'key-abc',
      pending: true,
    });
  });

  it('refund-expired reports pending false on a settled refusal', async () => {
    mockX402Post.mockRejectedValueOnce(rejectedError());
    const { refundExpiredCmd } = await import('../../src/commands/task/refund-expired.js');

    await run(refundExpiredCmd, ['refund-expired', TASK]);

    // The distinction the whole change exists for: this one is safe to run again, the one above
    // is not, and before this a script saw the same bare message for both.
    expect(envelope()).toMatchObject({ reason: 'payment_preflight_rejected', pending: false });
  });

  it('reject-submission reports pending on an in-flight write', async () => {
    mockX402Post.mockRejectedValueOnce(inFlightError());
    const { rejectSubmissionCmd } = await import('../../src/commands/task/reject-submission.js');

    await run(rejectSubmissionCmd, ['reject-submission', TASK, '--worker', WORKER]);

    expect(envelope()).toMatchObject({ reason: 'intent_in_flight', pending: true });
  });

  it('accept-submissions reports pending on an in-flight write', async () => {
    mockX402Post.mockRejectedValueOnce(inFlightError());
    const { acceptSubmissionsCmd } = await import('../../src/commands/task/accept-submissions.js');

    await run(acceptSubmissionsCmd, ['accept-submissions', TASK, '--winner', `${WORKER}:10000`]);

    expect(envelope()).toMatchObject({ reason: 'intent_in_flight', pending: true });
  });

  it('resolve-dispute lets its paid write reach the top-level handler with the envelope intact', async () => {
    mockX402Post.mockRejectedValueOnce(inFlightError());
    const { resolveDisputeCmd } = await import('../../src/commands/task/resolve-dispute.js');

    // This command does not catch its own paid failure -- it propagates, and index.ts renders it
    // through the same `renderFailure` the others call directly. Both routes are legal; what is
    // not legal is a third route that renders without the envelope. Asserted here so that
    // wrapping this call in a `catch` later cannot quietly drop the classification.
    const thrown = await resolveDisputeCmd
      .parseAsync(
        ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', `${WORKER}:5:1`],
        { from: 'node' }
      )
      .then(
        () => undefined,
        (err: unknown) => err
      );

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).envelope).toMatchObject({ reason: 'intent_in_flight' });
    expect(isInFlightApiError((thrown as ApiError).envelope)).toBe(true);
  });

  it('reject-all-submissions reports pending when one of its rejections is still landing', async () => {
    mockApiGet.mockResolvedValueOnce([{ workerAddress: WORKER, rejectedAt: null }]);
    mockX402Post.mockRejectedValueOnce(inFlightError());
    const { rejectAllSubmissionsCmd } =
      await import('../../src/commands/task/reject-all-submissions.js');

    await run(rejectAllSubmissionsCmd, ['reject-all-submissions', TASK]);

    const written = envelope();
    expect(written).toMatchObject({ reason: 'intent_in_flight', pending: true });
    // The context survives on the message and the per-worker detail survives beside it, so
    // wrapping cost the caller nothing it previously had.
    expect(written.error).toContain('1 of 1 rejection(s) failed');
    expect(written.results).toEqual([
      { worker: WORKER, error: expect.stringContaining('landing') },
    ]);
  });

  it('prefers the in-flight rejection over a settled one when a batch fails both ways', async () => {
    const WORKER_B = '0x3333333333333333333333333333333333333333';
    mockApiGet.mockResolvedValueOnce([
      { workerAddress: WORKER, rejectedAt: null },
      { workerAddress: WORKER_B, rejectedAt: null },
    ]);
    // The settled failure comes first, so a naive "report the first one" would answer
    // `pending: false` while a paid write was still alive.
    mockX402Post.mockRejectedValueOnce(rejectedError()).mockRejectedValueOnce(inFlightError());
    const { rejectAllSubmissionsCmd } =
      await import('../../src/commands/task/reject-all-submissions.js');

    await run(rejectAllSubmissionsCmd, ['reject-all-submissions', TASK]);

    expect(envelope()).toMatchObject({ reason: 'intent_in_flight', pending: true });
  });
});

describe('a local validation failure still renders with no envelope', () => {
  it('claims nothing about pending when nothing was ever sent', async () => {
    const { acceptSubmissionsCmd } = await import('../../src/commands/task/accept-submissions.js');

    await run(acceptSubmissionsCmd, ['accept-submissions', TASK, '--winner', `${WORKER}:5000`]);

    const written = envelope();
    expect(written).toMatchObject({ ok: false });
    expect(written.error).toContain('must sum to 10000');
    // Absent, not false. A `pending: false` here would be a claim, and the fields only exist when
    // the backend actually classified something.
    expect('pending' in written).toBe(false);
    expect('reason' in written).toBe(false);
    expect('status' in written).toBe(false);
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('renders a bad --award spec exactly as it did before, with no envelope', async () => {
    const { resolveDisputeCmd } = await import('../../src/commands/task/resolve-dispute.js');

    await run(resolveDisputeCmd, [
      'resolve-dispute',
      TASK,
      '--verdict',
      'approve',
      '--award',
      'badentry',
    ]);

    const written = envelope();
    expect(written.error).toContain('Invalid --award value');
    expect('pending' in written).toBe(false);
    expect(mockX402Post).not.toHaveBeenCalled();
  });
});
