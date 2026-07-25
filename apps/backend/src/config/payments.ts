import { STANDARD_X402_ACTION_AMOUNT, type PaidPendingActionNameValue } from '@taskmarket/shared';

export { STANDARD_X402_ACTION_AMOUNT };

export const TASK_CREATE_ROUTE = '/api/tasks';
export const IDENTITY_REGISTER_ROUTE = '/api/identity/register';

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
