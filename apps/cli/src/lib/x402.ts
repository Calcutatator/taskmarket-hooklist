import { apiErrorEnvelopeOf } from '@taskmarket/shared';

import { ApiError, API_URL, legalReceiptHeadersForKeystore } from './api.js';
import { idempotencyHeaders, resolveIdempotencyKey, withIdempotentWrite } from './idempotency.js';
import { loadKeystore } from './keystore.js';
import { createTransferAuthorization } from './signer.js';

interface PaymentRequirements {
  resource: unknown;
  accepts: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
      eip712: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
      };
    };
  }[];
}

export async function x402Post(
  path: string,
  body: Record<string, unknown>,
  options?: { idempotencyKey?: string }
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const keystore = await loadKeystore();
  const legalHeaders = legalReceiptHeadersForKeystore(keystore, path, 'POST');
  // One key for the whole exchange. Discovery and the paid retry are two rounds of a single
  // logical write, so round 2 must present the same key round 1 did.
  const idempotencyKey = resolveIdempotencyKey(options?.idempotencyKey);
  const idempotency = idempotencyHeaders(idempotencyKey);

  // The scope spans both rounds because both rounds are one write. A failure rendered
  // after the payment settled must report the key that payment was made under.
  return withIdempotentWrite(idempotencyKey, async () => {
    // Round 1: discover payment requirements
    const r1 = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...legalHeaders, ...idempotency },
      body: JSON.stringify(body),
    });

    if (r1.status !== 402) {
      if (r1.ok) {
        return r1.json();
      }
      const text = await r1.text().catch(() => '');
      // Round 1 can fail on a repeated or missing idempotency key, which the middleware rejects
      // ahead of the 402 challenge -- so the envelope has to be read here too, not only after
      // payment. Parsed defensively because a round-1 failure is not guaranteed to be JSON.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      throw new ApiError(
        r1.status,
        `POST ${path} failed (${r1.status}): ${text}`,
        idempotencyKey,
        apiErrorEnvelopeOf(parsed) ?? undefined
      );
    }

    const requirements = (await r1.json()) as PaymentRequirements;

    if (!requirements.accepts || requirements.accepts.length === 0) {
      throw new Error('No payment methods accepted by server');
    }

    const accept = requirements.accepts[0];

    const { authorization, signature } = await createTransferAuthorization(accept, keystore);

    const paymentPayload = {
      x402Version: 2,
      resource: requirements.resource,
      accepted: {
        scheme: accept.scheme,
        network: accept.network,
        amount: accept.amount,
        asset: accept.asset,
        payTo: accept.payTo,
        maxTimeoutSeconds: accept.maxTimeoutSeconds,
        extra: accept.extra,
      },
      payload: { authorization, signature },
    };

    // Round 2: retry with payment signature
    const r2 = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...legalHeaders,
        ...idempotency,
        'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      },
      body: JSON.stringify(body),
    });

    const result = await r2.json();
    if (!r2.ok) {
      // Round 2 failing is the case the key exists for: the payment has settled, so the caller has
      // already been charged for a write whose outcome the response no longer tells them.
      throw new ApiError(
        r2.status,
        `POST ${path} failed after payment (${r2.status}): ${JSON.stringify(result)}`,
        idempotencyKey,
        apiErrorEnvelopeOf(result) ?? undefined
      );
    }
    return result;
  });
}
