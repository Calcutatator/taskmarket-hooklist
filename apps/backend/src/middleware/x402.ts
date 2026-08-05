// Implements: ADR-0052
// Implements: ADR-0049
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { apiErrorBody } from '../lib/api-error';
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import {
  type IntentPaymentReference,
  recordIntentPaymentAuthorization,
  releaseUnpaidReservation,
  reserveRelayedWrite,
} from '../services/relayed-intents';
import { logger } from '../lib/logger';
import { createServerWallet } from '../lib/wallet';

const FACILITATOR_TIMEOUT_MS = 60_000;

export type X402PreflightCleanup = () => Promise<void>;

export interface X402Options {
  getAmount: (req: Request) => string | Promise<string>; // base units (6 decimals)
  description?: string;
  preflight?: (req: Request, payer: string, res: Response) => Promise<X402PreflightCleanup | void>;
}

export class X402PreflightError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400
  ) {
    super(message);
    this.name = 'X402PreflightError';
  }
}

/**
 * The settled payment behind this request, or nothing if the request was never charged.
 *
 * The only supported way to build an `IntentPaymentReference`. A handler cannot assemble one
 * out of `res.locals` by hand and get it half right, because there is no half: this returns
 * the whole reference or `undefined`, and `runRelayedIntent` accepts nothing else.
 *
 * Reading the amount from here rather than recomputing it is the point. A refund is paid out
 * of pooled escrow, so a wrong amount is worse than a missing one -- it returns somebody
 * else's money. The middleware already resolved the price for this exact request, including
 * the two routes that are not the flat action fee, so a handler that asks this question
 * cannot answer it differently from the facilitator that settled it.
 *
 * A free path (an unmetered submission, a claim, a withdrawal) simply has no locals set and
 * gets `undefined`, which is the accurate answer: there is nothing to refund.
 */
export function settledPaymentReference(res: Response): IntentPaymentReference | undefined {
  const payer = res.locals.payer as string | undefined;
  const amount = res.locals.paymentAmount as string | undefined;
  const txHash = res.locals.paymentTxHash as `0x${string}` | undefined;

  // A hash or an amount is what says money moved. `payer` alone does not: it is also set by
  // anything that authenticates a caller, and treating that as a broken payment would fire the
  // error below on ordinary free traffic -- the fastest way to make a log nobody reads. This
  // is the same test `settleAbandonedIntents` applies to a stored row, deliberately.
  if (!amount && !txHash) return undefined;
  if (!payer || !amount || !txHash) {
    // Reachable only if the middleware settled and then published an incomplete set --
    // today, a facilitator that reports success with no transaction hash. Loud rather than
    // silent, because the consequence is a payment nothing can refund: without a hash there
    // is no reference for `orphaned_payments` to key on, so the payer's money is in the
    // server wallet with nothing recording why (ADR-0048, ADR-0053).
    logger.error('Settled payment is missing part of its reference; it cannot be refunded', {
      hasAmount: Boolean(amount),
      hasPayer: Boolean(payer),
      hasTxHash: Boolean(txHash),
    });
    return undefined;
  }

  return { amount: BigInt(amount), payer, txHash };
}

export function x402Middleware(opts: X402Options): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const config = getServerConfig();
    const network = `eip155:${config.CHAIN_ID}`;
    const usdcAddress = config.USDC_TOKEN_ADDRESS;
    const payTo = createServerWallet().address;
    const resourceUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const description = opts.description ?? req.path;
    const chainId = config.CHAIN_ID;
    const USDC_DOMAIN = { name: config.USDC_DOMAIN_NAME, version: '2' };

    // Support both casing variants
    const paymentSignature =
      (req.headers['payment-signature'] as string | undefined) ??
      (req.headers['PAYMENT-SIGNATURE'] as string | undefined);

    let preflightCleanup: X402PreflightCleanup | undefined;
    let preflightCleanupPromise: Promise<void> | undefined;
    const cleanupPreflight = (): Promise<void> => {
      if (!preflightCleanup) return Promise.resolve();
      preflightCleanupPromise ??= Promise.resolve()
        .then(preflightCleanup)
        .catch((error: unknown) => {
          logger.error('X402 preflight cleanup failed', { error });
        });
      return preflightCleanupPromise;
    };

    // Implements: ADR-0052
    //
    // Ahead of everything, including the 402 challenge. This ordering is the decision, not an
    // optimisation, and it is load-bearing in a way that is easy to refactor away:
    //
    // Settlement happens in this middleware, before any handler runs. So a retry carrying the
    // original idempotency key would be challenged, sign a *fresh* authorization, have it
    // settled by the facilitator, and only then reach a handler that says "you already have an
    // intent". No second chain call -- and a second settled payment, with nothing to attach to,
    // which becomes an orphaned payment needing a refund. That is the double charge the key
    // exists to prevent, moved one layer up rather than removed. A key checked after settlement
    // is not an idempotency key; it is a deduplicator for chain calls only.
    //
    // The same argument applies to a *missing* key, which is why it is rejected here too: let
    // it through and the caller pays, then gets a 400 from `recordRelayedIntent` for a payment
    // that bought nothing.
    //
    // The conflict deliberately carries no payment facts. This runs before any caller is
    // authenticated -- on the challenge round there is not even a payment payload to read a
    // payer from -- so it can say that the key is spoken for and nothing else. The caller reads
    // the outcome from `intents.get`, which is payer-scoped and can safely say more (ADR-0049).
    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    let reservation: Awaited<ReturnType<typeof reserveRelayedWrite>>;
    try {
      reservation = await reserveRelayedWrite({
        db,
        description: opts.description,
        key: Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey,
        route: req.originalUrl,
      });
    } catch (error) {
      // Express 4 does not forward a rejected middleware promise, so an unhandled throw here
      // leaves the request hanging until the client gives up -- and this is now a database
      // write on the hot path of every paid endpoint. Failing closed is also the only safe
      // direction: a claim that did not complete cannot rule out that this key is already
      // spoken for, and proceeding would charge the caller on that assumption.
      logger.error('Idempotency reservation failed', { error });
      return res.status(503).json(
        apiErrorBody({
          reason: 'idempotency_check_unavailable',
          message: 'Unable to claim idempotency key; retry this request',
        })
      );
    }
    // The envelope travels beside `error` rather than replacing it. This reply never passes
    // through tRPC's `errorFormatter` -- the middleware answers `res` itself, before any
    // procedure runs -- so it publishes the discriminator under the same `taskmarket` key by
    // hand, and a client has one reader for a paid write refused at either layer (ADR-0058).
    if (reservation.refusal) {
      return res
        .status(reservation.refusal.status)
        .json({ error: reservation.refusal.error, taskmarket: reservation.refusal.envelope });
    }
    const reservedIntentId = reservation.intent.id;
    // Published so the handler's `recordRelayedIntent` and anything auditing the request can
    // name the reservation this request holds.
    res.locals.reservedIntentId = reservedIntentId;

    // Give the key back on any path that refuses the caller before they have paid. Conditional
    // on no authorization having been recorded, which `releaseUnpaidReservation` enforces: once
    // the settle call has been made, a thrown error does not establish that nothing settled,
    // and such a row belongs to the sweep (ADR-0067).
    const releaseReservation = async (): Promise<void> => {
      try {
        await releaseUnpaidReservation({ db, intentId: reservedIntentId });
      } catch (error) {
        // Nothing is lost by failing here -- the reservation expires on its own -- so this must
        // not turn a refusal the caller can act on into a 500.
        logger.error('Releasing an unpaid reservation failed; it will expire on its TTL', {
          error,
          intentId: reservedIntentId,
        });
      }
    };

    if (!paymentSignature) {
      // getAmount can be async and DB-backed; a rejection here must not
      // escape the middleware as an unhandled rejection (Express 4 does not
      // forward rejected middleware promises).
      let amount: string;
      try {
        amount = await opts.getAmount(req);
      } catch (err) {
        await releaseReservation();
        const msg = err instanceof Error ? err.message : 'Unable to compute payment amount';
        // 5xx because the price could not be resolved, which is ours to fix, but the reason is
        // still `payment_rejected`: from the caller's side the exchange did not begin and
        // nothing was charged, which is the only fact they can act on.
        return res.status(500).json(apiErrorBody({ reason: 'payment_rejected', message: msg }));
      }
      const requirements = {
        x402Version: 2,
        error: 'Payment required',
        resource: { url: resourceUrl, description, mimeType: 'application/json' },
        accepts: [
          {
            scheme: 'exact',
            network,
            amount,
            asset: usdcAddress,
            payTo,
            maxTimeoutSeconds: 300,
            extra: {
              ...USDC_DOMAIN,
              eip712: {
                domain: { ...USDC_DOMAIN, chainId, verifyingContract: usdcAddress },
                types: {
                  TransferWithAuthorization: [
                    { name: 'from', type: 'address' },
                    { name: 'to', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'validAfter', type: 'uint256' },
                    { name: 'validBefore', type: 'uint256' },
                    { name: 'nonce', type: 'bytes32' },
                  ],
                },
                primaryType: 'TransferWithAuthorization',
              },
            },
          },
        ],
      };
      res.setHeader(
        'PAYMENT-REQUIRED',
        Buffer.from(JSON.stringify(requirements)).toString('base64')
      );
      return res.status(402).json(requirements);
    }

    try {
      const paymentPayload = JSON.parse(Buffer.from(paymentSignature, 'base64').toString());

      if (paymentPayload.x402Version !== 2) {
        throw new Error('Invalid x402 version, expected v2');
      }

      const payer: string = paymentPayload?.payload?.authorization?.from;
      if (!payer) throw new Error('Missing payer address in payment payload');

      const expectedAmount = await opts.getAmount(req);
      const accepted = paymentPayload?.accepted;
      const authorization = paymentPayload?.payload?.authorization;
      if (
        accepted?.scheme !== 'exact' ||
        accepted?.network !== network ||
        accepted?.amount !== expectedAmount ||
        accepted?.asset?.toLowerCase() !== usdcAddress.toLowerCase() ||
        accepted?.payTo?.toLowerCase() !== payTo.toLowerCase() ||
        String(authorization?.value) !== expectedAmount ||
        authorization?.to?.toLowerCase() !== payTo.toLowerCase()
      ) {
        throw new Error('Payment payload does not match server requirements');
      }

      // Validate payment hasn't expired
      const validBefore = Number(paymentPayload.payload.authorization.validBefore);
      if (validBefore < Math.floor(Date.now() / 1000) + 6) {
        throw new Error('Payment authorization has expired');
      }

      // Validate current task state and declared payer before settlement. A
      // preflight may reserve mutable state and return an idempotent release.
      preflightCleanup = (await opts.preflight?.(req, payer, res)) ?? undefined;

      const paymentRequirements = {
        scheme: 'exact',
        network,
        amount: expectedAmount,
        resource: resourceUrl,
        description,
        mimeType: 'application/json',
        payTo,
        maxTimeoutSeconds: 300,
        asset: usdcAddress,
        extra: USDC_DOMAIN,
      };

      const facilitatorHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.X402_FACILITATOR_TOKEN) {
        facilitatorHeaders['Authorization'] = `Bearer ${config.X402_FACILITATOR_TOKEN}`;
      }

      // Implements: ADR-0067 -- write-ahead, before the irreversible step.
      //
      // This is the same move ADR-0045 made for chain calls, one layer further out: record what
      // is about to happen before asking for it, so a process that dies mid-settlement leaves a
      // reservation naming the exact authorization rather than a row indistinguishable from an
      // abandoned challenge. The binding between this payment and this reservation exists right
      // here and nowhere else -- x402's payment requirements carry no nonce field, so the
      // facilitator never sees ours and a settled payment cannot name its own reservation. What
      // is durable is what we write down before we ask.
      //
      // It is a record of an attempt, never evidence money moved: the facilitator may reject
      // this authorization, and it may never be settled at all.
      await recordIntentPaymentAuthorization({
        db,
        amount: expectedAmount,
        intentId: reservedIntentId,
        nonce: String(authorization?.nonce ?? ''),
        payer,
      });

      const settleRes = await fetchWithTimeout(
        `${config.X402_FACILITATOR_URL}/settle`,
        {
          method: 'POST',
          headers: facilitatorHeaders,
          body: JSON.stringify({ paymentPayload, paymentRequirements }),
        },
        FACILITATOR_TIMEOUT_MS
      );

      if (!settleRes.ok) {
        const text = await settleRes.text().catch(() => '');
        throw new Error(`Facilitator error: ${settleRes.status} ${text}`);
      }

      const settle = (await settleRes.json()) as {
        success: boolean;
        transaction?: string;
        payer?: string;
        errorReason?: string;
      };

      if (!settle.success) {
        throw new Error(`Settlement failed: ${settle.errorReason ?? 'unknown'}`);
      }
      if (settle.payer && settle.payer.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Facilitator payer does not match payment authorization');
      }

      // Settlement confirmed -- USDC is now in server wallet.
      //
      // All three facts are published together because they are one fact: this payer moved
      // this much in this transaction. A handler that could see two of them and not the third
      // would be able to record a payment reference that settlement cannot refund, which is
      // exactly the defect `settledPaymentReference` below exists to make unrepresentable.
      //
      // `expectedAmount` rather than anything recomputed downstream: it is the number the
      // authorization was checked against a few lines up and the number the facilitator
      // settled, so it is what the payer was actually billed. Every variable-priced route
      // (tasks.create's reward, tasks.update's reward increase) is already resolved here, so
      // nothing further down has to know a pricing rule to refund correctly.
      res.locals.payer = payer;
      res.locals.paymentAmount = expectedAmount;
      res.locals.paymentTxHash = settle.transaction;
      res.setHeader(
        'PAYMENT-RESPONSE',
        Buffer.from(JSON.stringify({ success: true, transaction: settle.transaction })).toString(
          'base64'
        )
      );
      if (preflightCleanup) {
        res.once('finish', cleanupPreflight);
      }
      next();
    } catch (err) {
      await cleanupPreflight();
      // Best effort, and precisely bounded: this only takes the key back when no authorization
      // was ever recorded against it. A failure after the settle call was made leaves the row
      // for the sweep, which can ask the token contract whether the nonce was consumed --
      // a question this catch block has no way to answer (ADR-0067).
      await releaseReservation();
      const msg = err instanceof Error ? err.message : 'Payment verification failed';
      if (err instanceof X402PreflightError) {
        return res
          .status(err.status)
          .json(apiErrorBody({ reason: 'payment_preflight_rejected', message: msg }));
      }
      // The x402 fields stay exactly where they are -- this body is part of the x402 exchange
      // and a payment client parses it. The envelope is added beside them, so a caller that only
      // speaks x402 is unaffected and one that speaks both can classify without reading `error`.
      res.status(402).json({
        x402Version: 2,
        error: msg,
        resource: { url: resourceUrl, description, mimeType: 'application/json' },
        accepts: [],
        taskmarket: apiErrorBody({ reason: 'payment_rejected', message: msg }).taskmarket,
      });
    }
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
