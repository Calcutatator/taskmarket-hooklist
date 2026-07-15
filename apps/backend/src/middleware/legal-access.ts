import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { getServerConfig } from '../config/env';
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_RECEIPT_HEADER,
  getCurrentLegalBundle,
  verifyLegalReceipt,
} from '../services/legal';

const EXIT_OR_PUBLIC_WRITE_ROUTES = [
  /^\/api\/legal(?:\/|$)/,
  /^\/api\/devices(?:\/|$)/,
  /^\/api\/task-drops\/subscribe$/,
  /^\/api\/emails\/delete$/,
  /^\/api\/wallet\/(?:withdraw|withdraw-dreams|set-withdrawal-address)$/,
  /^\/api\/tasks\/[^/]+\/(?:cancel|refund-expired|appeal|evaluator-timeout|finalize-verdict|resolve-dispute|forfeit|reject-submission)$/,
  /^\/api\/tasks\/[^/]+\/submissions\/[^/]+\/preview$/,
];

const EXIT_OR_PUBLIC_TRPC_PROCEDURES = new Set([
  'claims.forfeit',
  'devices.key',
  'devices.register',
  'devices.status',
  'emails.delete',
  'evaluations.appeal',
  'evaluations.evaluatorTimeout',
  'evaluations.finalizeVerdict',
  'evaluations.resolveDispute',
  'legal.acceptWallet',
  'legal.acceptWeb',
  'legal.challenge',
  'legal.current',
  'legal.status',
  'taskDrops.subscribe',
  'submissions.preview',
  'tasks.cancel',
  'tasks.refundExpired',
  'tasks.rejectSubmission',
  'wallet.setWithdrawalAddress',
  'wallet.withdraw',
  'wallet.withdrawDreams',
]);

function requestPath(req: Request): string {
  return req.originalUrl.split('?')[0];
}

export function isLegalReceiptExempt(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const path = requestPath(req);
  if (path.startsWith('/trpc/')) {
    let procedurePath: string;
    try {
      procedurePath = decodeURIComponent(path.slice('/trpc/'.length));
    } catch {
      return false;
    }
    const procedures = procedurePath.split(',');
    return (
      procedures.length > 0 &&
      procedures.every((procedure) => EXIT_OR_PUBLIC_TRPC_PROCEDURES.has(procedure))
    );
  }
  return EXIT_OR_PUBLIC_WRITE_ROUTES.some((pattern) => pattern.test(path));
}

export const legalAccessMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const config = getServerConfig();
  if (!config.LEGAL_ENFORCEMENT_ENABLED || isLegalReceiptExempt(req)) {
    next();
    return;
  }

  const value = req.headers[LEGAL_RECEIPT_HEADER];
  const receipt = Array.isArray(value) ? value[0] : value;
  let identity: Awaited<ReturnType<typeof verifyLegalReceipt>>;
  try {
    identity = receipt ? await verifyLegalReceipt(receipt) : null;
  } catch {
    res.status(503).json({
      code: 'LEGAL_STATUS_UNAVAILABLE',
      error: 'Taskmarket could not verify legal acceptance. Try again before submitting.',
    });
    return;
  }
  if (identity) {
    res.locals.legalAcceptance = identity;
    next();
    return;
  }

  const bundle = getCurrentLegalBundle();
  res.setHeader('X-Taskmarket-Legal-Version', bundle.version);
  res.status(403).json({
    code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
    error: 'Current Taskmarket legal terms must be accepted before starting new activity.',
    legal: {
      acceptUrl: new URL('/legal', config.WEB_APP_URL).toString(),
      bundleVersion: bundle.version,
      cliCommand: 'taskmarket legal accept',
    },
  });
};
