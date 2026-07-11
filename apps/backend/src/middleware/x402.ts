import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getServerConfig } from '../config/env';
import { createServerWallet } from '../lib/wallet';

const FACILITATOR_TIMEOUT_MS = 60_000;

export interface X402Options {
  getAmount: (req: Request) => string | Promise<string>; // base units (6 decimals)
  description?: string;
  preflight?: (req: Request, payer: string) => Promise<void>;
}

export class X402PreflightError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400
  ) {
    super(message);
    this.name = 'X402PreflightError';
  }
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

    if (!paymentSignature) {
      // getAmount can be async and DB-backed; a rejection here must not
      // escape the middleware as an unhandled rejection (Express 4 does not
      // forward rejected middleware promises).
      let amount: string;
      try {
        amount = await opts.getAmount(req);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to compute payment amount';
        return res.status(500).json({ error: msg });
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

      // Validate current task state and declared payer before settlement. The
      // router repeats authorization after settlement; this pass prevents a
      // known-invalid request from charging the caller first.
      await opts.preflight?.(req, payer);

      // Validate payment hasn't expired
      const validBefore = Number(paymentPayload.payload.authorization.validBefore);
      if (validBefore < Math.floor(Date.now() / 1000) + 6) {
        throw new Error('Payment authorization has expired');
      }

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

      // Settlement confirmed — USDC is now in server wallet
      res.locals.payer = settle.payer ?? payer;
      res.locals.paymentTxHash = settle.transaction;
      res.setHeader(
        'PAYMENT-RESPONSE',
        Buffer.from(JSON.stringify({ success: true, transaction: settle.transaction })).toString(
          'base64'
        )
      );
      next();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment verification failed';
      if (err instanceof X402PreflightError) {
        return res.status(err.status).json({ error: msg });
      }
      res.status(402).json({
        x402Version: 2,
        error: msg,
        resource: { url: resourceUrl, description, mimeType: 'application/json' },
        accepts: [],
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
