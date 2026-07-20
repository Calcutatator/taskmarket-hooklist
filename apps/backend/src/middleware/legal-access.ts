import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { LEGAL_RECEIPT_HEADER } from '@taskmarket/shared';

import { getServerConfig } from '../config/env';
import type { Context } from '../context';
import { verifyPrivyAccessToken } from '../lib/privy-auth';
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  getCurrentLegalBundle,
  verifyLegalReceipt,
} from '../services/legal';
import { authenticateXmtpDevice } from '../services/xmtp-auth';

const EXIT_OR_PUBLIC_WRITE_ROUTES = [
  /^\/api\/legal(?:\/|$)/,
  /^\/api\/devices\/[^/]+\/key$/,
  /^\/api\/task-drops\/subscribe$/,
  /^\/api\/task-drops\/official\/subscribe$/,
  /^\/api\/emails\/delete$/,
  /^\/api\/wallet\/(?:withdraw|withdraw-dreams|set-withdrawal-address)$/,
  /^\/api\/tasks\/[^/]+\/(?:accept|accept-submissions|cancel|refund-expired|appeal|evaluator-timeout|finalize-verdict|resolve-dispute|forfeit|reject-submission)$/,
  /^\/api\/tasks\/[^/]+\/submissions\/[^/]+\/preview$/,
];

const EXIT_OR_PUBLIC_TRPC_PROCEDURES = new Set([
  'claims.forfeit',
  'acceptance.accept',
  'acceptance.acceptSubmissions',
  'devices.key',
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
  'taskDrops.subscribeOfficial',
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

const ACTING_WALLET_FIELDS = [
  'requesterAddress',
  'workerAddress',
  'evaluatorAddress',
  'resolverAddress',
  'bidderAddress',
  'walletAddress',
  'agentAddress',
  'address',
] as const;

function normalizedAddress(value: unknown): string | undefined {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value.toLowerCase()
    : undefined;
}

function requestActingWallet(req: Request): string | undefined {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return undefined;
  const body = req.body as Record<string, unknown>;
  for (const field of ACTING_WALLET_FIELDS) {
    const address = normalizedAddress(body[field]);
    if (address) return address;
  }
  return undefined;
}

function requestPaymentPayer(req: Request): string | undefined {
  const header = req.headers['payment-signature'];
  const paymentSignature = Array.isArray(header) ? header[0] : header;
  if (!paymentSignature) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(paymentSignature, 'base64').toString()) as {
      payload?: { authorization?: { from?: unknown } };
    };
    return normalizedAddress(payload.payload?.authorization?.from);
  } catch {
    return undefined;
  }
}

function requestDeviceCredentials(req: Request): Array<{ apiToken: string; deviceId: string }> {
  const header = req.headers['x-taskmarket-api-token'];
  const headerToken = Array.isArray(header) ? header[0] : header;
  const credentials = new Map<string, { apiToken: string; deviceId: string }>();

  const visit = (value: unknown, root = false): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }

    const record = value as Record<string, unknown>;
    const apiToken = typeof record.apiToken === 'string' ? record.apiToken : headerToken;
    if (typeof record.deviceId === 'string' && typeof apiToken === 'string') {
      credentials.set(`${record.deviceId}\0${apiToken}`, {
        apiToken,
        deviceId: record.deviceId,
      });
    }

    for (const [key, nested] of Object.entries(record)) {
      if (key === 'input' || key === 'json' || (root && /^\d+$/.test(key))) {
        visit(nested);
      }
    }
  };

  visit(req.body, true);
  return [...credentials.values()];
}

function expectsX402Payment(req: Request): boolean {
  const path = requestPath(req);
  return (
    path === '/api/tasks' ||
    path === '/api/identity/register' ||
    path === '/trpc/identity.register' ||
    /^\/api\/tasks\/[^/]+\/(?:bids(?:\/accept)?|evaluate|pitches(?:\/select)?|proofs|rate|update)$/.test(
      path
    )
  );
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

export function createLegalAccessMiddleware(context: Pick<Context, 'db'>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const config = getServerConfig();
    if (!config.LEGAL_ENFORCEMENT_ENABLED || isLegalReceiptExempt(req)) {
      next();
      return;
    }

    const value = req.headers[LEGAL_RECEIPT_HEADER.toLowerCase()];
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
      if (identity.subjectType === 'privy_user') {
        try {
          const claim = await verifyPrivyAccessToken(req.headers.authorization);
          if (claim.user_id !== identity.subjectId) {
            identity = null;
          }
        } catch {
          identity = null;
        }
      } else if (identity.subjectType === 'wallet') {
        const expectedWallet = identity.subjectId.toLowerCase();
        const payer = requestPaymentPayer(req);
        const actingWallet = requestActingWallet(req);
        const deviceWallets: string[] = [];
        for (const deviceCredentials of requestDeviceCredentials(req)) {
          try {
            const device = await authenticateXmtpDevice(context, deviceCredentials);
            deviceWallets.push(device.walletAddress.toLowerCase());
          } catch {
            // The downstream procedure remains responsible for invalid device credentials.
          }
        }
        // An unpaid X402 probe never mutates state here: x402Middleware (mounted after this
        // middleware in app.ts) intercepts it and returns 402 with pricing before any router
        // handler runs. Binding is enforced on the paid retry via the payer check above.
        if (
          deviceWallets.some((wallet) => wallet !== expectedWallet) ||
          (payer
            ? payer !== expectedWallet
            : !expectsX402Payment(req) && actingWallet !== expectedWallet)
        ) {
          identity = null;
        }
      } else {
        identity = null;
      }
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
}
