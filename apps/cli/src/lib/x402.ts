import { API_URL } from './api.js';
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
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const keystore = await loadKeystore();

  // Round 1: discover payment requirements
  const r1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (r1.status !== 402) {
    if (r1.ok) {
      return r1.json();
    }
    const text = await r1.text().catch(() => '');
    throw new Error(`POST ${path} failed (${r1.status}): ${text}`);
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
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
    },
    body: JSON.stringify(body),
  });

  const result = await r2.json();
  if (!r2.ok) {
    throw new Error(`POST ${path} failed after payment (${r2.status}): ${JSON.stringify(result)}`);
  }
  return result;
}
