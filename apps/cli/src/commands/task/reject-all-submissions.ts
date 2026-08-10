import { Command } from 'commander';
import { apiGet, isPendingApiError, withErrorContext } from '../../lib/api.js';
import { x402Post } from '../../lib/x402.js';
import { idempotencyKeyForError } from '../../lib/idempotency.js';
import { printResult, renderFailure } from '../../lib/output.js';

type Submission = {
  workerAddress: string;
  rejectedAt?: string | null;
};

export function activeSubmissionWorkers(submissions: Submission[]): string[] {
  const workers = new Map<string, string>();
  for (const submission of submissions) {
    if (submission.rejectedAt !== null && submission.rejectedAt !== undefined) continue;
    const normalized = submission.workerAddress.toLowerCase();
    if (!workers.has(normalized)) workers.set(normalized, submission.workerAddress);
  }
  return [...workers.values()];
}

export const rejectAllSubmissionsCmd = new Command('reject-all-submissions')
  .description(
    'Reject every active submission on a bounty or benchmark task in one go. ' +
      'Lists active submissions, rejects each unique worker ' +
      'in sequence, then cancels the task. Use this to recover escrow when all ' +
      'submitted work is unsuitable.'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--no-cancel', 'Reject all submissions but do not cancel the task afterward')
  .action(async (taskId: string, opts: { cancel: boolean }) => {
    let submissions: Submission[];
    try {
      submissions = (await apiGet(`/api/tasks/${taskId}/submissions`)) as Submission[];
    } catch (err) {
      renderFailure(err);
      return;
    }

    const workers = activeSubmissionWorkers(submissions);

    if (workers.length === 0) {
      printResult({ rejected: 0, message: 'no active submissions to reject' });
      return;
    }

    // Each rejection is its own paid write, so each can fail its own way -- and `cause` is kept
    // beside the message because the message alone is what used to reach the caller, with the
    // classification of every one of these writes thrown away.
    //
    // `idempotencyKey` is recorded per rejection for the same reason. This command's one envelope
    // cannot name a single key -- there are as many writes as there are workers -- so the keys
    // travel in `results`, where each sits beside the rejection it belongs to and an operator
    // reconciling afterwards can tell which is which.
    const results: Array<{
      worker: string;
      txHash?: string;
      idempotencyKey?: string;
      error?: string;
      cause?: unknown;
    }> = [];

    for (const worker of workers) {
      try {
        const { data: res, idempotencyKey } = await x402Post<Record<string, unknown>>(
          `/api/tasks/${taskId}/reject-submission`,
          { taskId, worker }
        );
        results.push({ worker, txHash: res.txHash as string | undefined, idempotencyKey });
      } catch (err) {
        // A failed rejection's key is the one most worth having, since it is the handle to a
        // write that may still be landing. It is read off the error rather than captured above,
        // because a write that threw never returned anything to capture.
        results.push({
          worker,
          error: err instanceof Error ? err.message : String(err),
          idempotencyKey: idempotencyKeyForError(err),
          cause: err,
        });
      }
    }

    const failed = results.filter((r) => r.error !== undefined);
    if (failed.length > 0) {
      // One envelope has to be the command's answer, so it is the one the caller must act on: an
      // in-flight rejection may still land, and re-running the command would pay for it a second
      // time. A definitively-failed rejection is safe to re-run, so it never outranks an in-flight
      // one. Every individual outcome still travels in `results`, so nothing is hidden by the
      // choice -- what the top-level `pending` answers is "is it safe to run this again", and the
      // answer is no if any one of these is still alive.
      const representative = failed.find((r) => isPendingApiError(r.cause)) ?? failed[0];
      renderFailure(
        withErrorContext(
          representative.cause,
          `${failed.length} of ${results.length} rejection(s) failed`
        ),
        {
          details: {
            results: results.map(({ worker, txHash, idempotencyKey, error }) => ({
              worker,
              txHash,
              idempotencyKey,
              error,
            })),
          },
        }
      );
      return;
    }

    // No `idempotencyKey` on these envelopes, on purpose. Several writes happened and the field
    // names one operation, so stamping it with any single rejection's key would tell an operator
    // that key is the handle to what this command did. The per-rejection keys are in `results`.
    if (!opts.cancel) {
      printResult({ rejected: results.length, results });
      return;
    }

    let cancelRes: Record<string, unknown>;
    try {
      ({ data: cancelRes } = await x402Post<Record<string, unknown>>(
        `/api/tasks/${taskId}/cancel`,
        { taskId }
      ));
    } catch (err) {
      // The rejections are done and paid for; only the cancel is in question. Wrapping rather
      // than restating keeps the cancel's own `reason` and `pending` on the envelope, so a script
      // can tell a cancel that is still landing (leave it alone) from one that was refused
      // (`taskmarket task cancel` is safe to run on its own) without re-reading the sentence.
      renderFailure(
        withErrorContext(err, `All ${results.length} submission(s) rejected but cancel failed`)
      );
      return;
    }

    printResult({ rejected: results.length, results, cancelTxHash: cancelRes.txHash });
  });
