// Implements: ADR-0035, ADR-0037
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { STANDARD_X402_ACTION_AMOUNT } from '../config/payments';
import type { db as Database } from '../db/client';
import { tasks } from '../db/schema';
import { logger } from '../lib/logger';
import {
  HARD_CEILING_MESSAGE,
  isOverHardSubmissionCeiling,
  isWithinFreeSubmissionAllowance,
} from '../services/submission-allowance';
import { x402Middleware } from './x402';

const METERED_TASK_MODES = new Set(['bounty', 'benchmark']);

export interface SubmissionAllowanceGateOptions {
  description: string;
}

/**
 * RFC-0006 Tier 1: gates the submission-create routes (`submit`, `submitFromKeys`) so a
 * bounty/benchmark worker's first FREE_SUBMISSION_ALLOWANCE submissions to a task bypass
 * x402Middleware entirely, and every submission after that goes through the normal paid
 * flow unchanged. See docs/rfc/0006-submission-spam-free-allowance-pricing.md's Proposal
 * section for why this is a bypass rather than a zero-priced payment: a zero-value
 * `transferWithAuthorization` is a technically valid signature, but settling it still
 * costs a facilitator round-trip and gas for nothing.
 *
 * Claim/pitch/auction submissions are NOT metered -- RFC-0006 scopes Tier 1 to
 * bounty/benchmark only (those modes already gate entry behind worker selection, so they
 * are not spammable the same way). Those submissions stay exactly as unmetered as they
 * were before this change: this middleware calls next() immediately for any task whose
 * mode is not in METERED_TASK_MODES.
 *
 * Must run after validateBody(SubmissionCreateSchema | SubmissionCreateFromKeysSchema) --
 * it reads req.body.taskId / req.body.workerAddress, which validateBody has already
 * merged from req.params and typed. workerAddress is NOT authenticated at this point
 * (signature verification happens later, in submissions.router.ts); it is used here only
 * to read the free-allowance count from the submissions table, never to write anything,
 * so a spoofed address can at most read someone else's count, not consume their
 * allowance -- see submission-allowance.ts's doc comment for why counting is DB-backed
 * rather than attempt-backed.
 */
export function submissionAllowanceGate(
  database: typeof Database,
  opts: SubmissionAllowanceGateOptions
): RequestHandler {
  const paidPath = x402Middleware({
    getAmount: () => STANDARD_X402_ACTION_AMOUNT,
    description: opts.description,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.body?.taskId as string | undefined;
    const workerAddress = req.body?.workerAddress as string | undefined;

    if (taskId && workerAddress) {
      try {
        const taskRows = await database
          .select({ mode: tasks.mode })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);
        const mode = taskRows[0]?.mode;

        if (mode && METERED_TASK_MODES.has(mode)) {
          // RFC-0006 Tier 2 (ADR-0037): checked before the free-allowance check --
          // "is this submission even allowed at all" before "does it need to be paid
          // for". Unlike the task-lookup failure path above (fail open, unchanged),
          // this specific query fails CLOSED: it's a safety bound, not a pricing
          // convenience. Reuses the same DB-backed count Tier 1 already trusts
          // (countSuccessfulSubmissions via isOverHardSubmissionCeiling) -- no new
          // failure mode beyond "reject" for this one query.
          let overHardCeiling: boolean;
          try {
            overHardCeiling = await isOverHardSubmissionCeiling(database, taskId, workerAddress);
          } catch (err) {
            logger.error('submissionAllowanceGate: hard-ceiling check failed, rejecting', {
              err,
              taskId,
              workerAddress,
            });
            return res.status(429).json({ error: HARD_CEILING_MESSAGE });
          }

          if (overHardCeiling) {
            // Reject outright -- do not construct or call x402Middleware at all on
            // this path; the point is to block, not to offer a paid path past the
            // ceiling.
            return res.status(429).json({ error: HARD_CEILING_MESSAGE });
          }

          // Own try/catch, not the outer one: the outer catch's fail-open behavior
          // exists for the task-lookup failure path (this route had no gate at all
          // before RFC-0006). This query is different -- the ceiling check just above
          // already confirmed the submission is otherwise permitted, so the only
          // question left is free-or-paid. Failing open here would silently skip
          // payment on a real error instead of the safer default (require payment);
          // fail closed to the paid path instead, matching the reasoning already
          // applied to the ceiling check.
          let withinAllowance: boolean;
          try {
            withinAllowance = await isWithinFreeSubmissionAllowance(
              database,
              taskId,
              workerAddress
            );
          } catch (err) {
            logger.error(
              'submissionAllowanceGate: free-allowance check failed, routing to paid path',
              { err, taskId, workerAddress }
            );
            return paidPath(req, res, next);
          }
          if (withinAllowance) {
            return next();
          }
          return paidPath(req, res, next);
        }
      } catch (err) {
        // Fail open to this route's pre-existing behavior (no payment gate at all)
        // rather than newly charging a worker because an internal lookup failed --
        // this route had zero x402 gate before RFC-0006, so an internal error here
        // should not silently introduce one. The router's own checks (task
        // existence, status, eligibility) still run downstream regardless.
        logger.error('submissionAllowanceGate: task lookup failed, allowing unmetered', {
          err,
          taskId,
        });
        return next();
      }
    }

    // Non-bounty/benchmark modes, or a task lookup that came back empty (unknown
    // taskId -- the router below returns NOT_FOUND) -- stay unmetered, matching this
    // route's behavior before RFC-0006.
    return next();
  };
}
