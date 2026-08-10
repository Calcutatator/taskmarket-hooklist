import { STANDARD_X402_ACTION_AMOUNT, type PaidPendingActionNameValue } from '@taskmarket/shared';
import { getHardSubmissionCeilingOverride, getSubmissionFreeAllowanceOverride } from './env';

export { STANDARD_X402_ACTION_AMOUNT };

/**
 * Implements: ADR-0036
 * Free-submission allowance for bounty/benchmark tasks (RFC-0006 Tier 1,
 * docs/rfc/0006-submission-spam-free-allowance-pricing.md). The first N successful
 * submissions from a worker to a given task are free and bypass x402Middleware
 * entirely; submission N+1 onward is priced at STANDARD_X402_ACTION_AMOUNT. See
 * apps/backend/src/services/submission-allowance.ts.
 *
 * Decided (not an agent placeholder): 5, per
 * docs/adr/0036-free-submission-allowance-is-five.md. Change this one value to adjust the
 * production default; do not scatter the number elsewhere. If this ever needs retuning
 * against real worker revision-count data, that's a new decision -- record it as an
 * amendment to ADR-0036, not a silent constant edit.
 *
 * This is the *default* only. Callers that need the effective allowance (including any
 * SUBMISSION_FREE_ALLOWANCE env override -- see getFreeSubmissionAllowance below) must not
 * read this constant directly.
 */
export const FREE_SUBMISSION_ALLOWANCE = 5;

/**
 * Effective free-submission allowance: SUBMISSION_FREE_ALLOWANCE env override when set,
 * else FREE_SUBMISSION_ALLOWANCE. The override exists so smoke tests and similar
 * harnesses -- which legitimately submit many times to the same (worker, task) as part of
 * ordinary multi-submission coverage, not spam -- can raise the allowance well above the
 * small production default (e.g. 1000) instead of needing to route every one of those
 * submissions through x402Post. See scripts/cloud-env-setup.sh's generated .env and
 * .env.example for where this gets set for the smoke/sandbox environment.
 */
export function getFreeSubmissionAllowance(): number {
  return getSubmissionFreeAllowanceOverride() ?? FREE_SUBMISSION_ALLOWANCE;
}

/**
 * Implements: ADR-0037
 * Tier 2 hard ceiling (RFC-0006): the absolute maximum successful submissions a worker may
 * make to a single bounty/benchmark task, regardless of Tier 1 pricing. Per (worker, task) --
 * see ADR-0037 for why this is explicitly not platform-wide or cross-task.
 *
 * This is the *production default* only. Callers that need the effective ceiling (including
 * any HARD_SUBMISSION_CEILING env override -- see getHardSubmissionCeiling below) must not
 * read this constant directly.
 */
export const HARD_SUBMISSION_CEILING = 100;

/**
 * Implements: ADR-0037
 * Effective hard submission ceiling: HARD_SUBMISSION_CEILING env override when set, else
 * HARD_SUBMISSION_CEILING. Docs/specs/submission-tier-2-hard-ceiling.md's original "no env
 * override is needed" call still holds for production -- this default stays at exactly 100
 * whenever the env var is unset. The override exists purely for test ergonomics: a smoke
 * test can lower the ceiling to a small value (e.g. 7) to cheaply prove the exact boundary
 * end-to-end, instead of doing ~94 real paid X402 round-trips to reach the real default. See
 * apps/backend/src/scripts/smoke-rate-limit.ts and getHardSubmissionCeilingOverride
 * (config/env.ts).
 */
export function getHardSubmissionCeiling(): number {
  return getHardSubmissionCeilingOverride() ?? HARD_SUBMISSION_CEILING;
}

export const TASK_CREATE_ROUTE = '/api/tasks';
export const IDENTITY_REGISTER_ROUTE = '/api/identity/register';

/**
 * Implements: ADR-0047 -- evaluator assignment has its own route.
 *
 * Deliberately not in PAID_TASK_ACTION_ROUTES below: that map is pinned to
 * PAID_PENDING_ACTION_NAMES, and assigning an evaluator is an option a requester may take, not
 * something the task is waiting on. Putting it there would oblige every open task to advertise
 * it as an outstanding action.
 */
export const TASK_ASSIGN_EVALUATOR_ROUTE = '/api/tasks/:taskId/evaluator';

/**
 * Submission-create routes gated by RFC-0006 Tier 1's submissionAllowanceGate rather
 * than an unconditional x402Middleware -- see
 * apps/backend/src/middleware/submissionAllowanceGate.ts.
 */
export const SUBMISSION_ROUTES = {
  submit: '/api/tasks/:taskId/submissions',
  submitFromKeys: '/api/tasks/:taskId/submissions/from-keys',
} as const;

export const PAID_TASK_ACTION_ROUTES = {
  accept: '/api/tasks/:taskId/accept',
  accept_submissions: '/api/tasks/:taskId/accept-submissions',
  appeal: '/api/tasks/:taskId/appeal',
  auction_accept: '/api/tasks/:taskId/bids/accept',
  bid: '/api/tasks/:taskId/bids',
  cancel: '/api/tasks/:taskId/cancel',
  evaluate: '/api/tasks/:taskId/evaluate',
  evaluator_timeout: '/api/tasks/:taskId/evaluator-timeout',
  pitch: '/api/tasks/:taskId/pitches',
  rate: '/api/tasks/:taskId/rate',
  refund_expired: '/api/tasks/:taskId/refund-expired',
  reject_submission: '/api/tasks/:taskId/reject-submission',
  resolve_dispute: '/api/tasks/:taskId/resolve-dispute',
  select_worker: '/api/tasks/:taskId/pitches/select',
  submit_proof: '/api/tasks/:taskId/proofs',
  update: '/api/tasks/:taskId/update',
} as const satisfies Record<PaidPendingActionNameValue, string>;
