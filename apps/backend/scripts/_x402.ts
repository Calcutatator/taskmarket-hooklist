/**
 * Shared helpers for smoke test scripts.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';

export type Account = ReturnType<typeof privateKeyToAccount>;

export const API_URL = process.env.API_URL || 'http://localhost:3000';

export function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

export function ok(label: string, value: unknown) {
  console.log(`  ✓ ${label}:`, value);
}

export function fail(step: string, status: number, body: string): never {
  console.error(`\n✗ ${step} failed (HTTP ${status}):\n${body}`);
  process.exit(1);
}

/** POST without X402. */
export async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) fail(path, r.status, JSON.stringify(result, null, 2));
  return result;
}

/** POST with full X402 dance — gets 402, signs EIP-712, retries. */
export async function x402Post(
  path: string,
  body: Record<string, unknown>,
  account: Account
): Promise<unknown> {
  const url = `${API_URL}${path}`;

  // Round 1: get payment requirements
  const r1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (r1.status !== 402) fail(path, r1.status, await r1.text());

  const requirements = (await r1.json()) as {
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
  };

  const accept = requirements.accepts[0];
  ok('amount', `${Number(accept.amount) / 1e6} USDC`);

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: accept.payTo,
    value: accept.amount,
    validAfter: String(now - 60),
    validBefore: String(now + accept.maxTimeoutSeconds),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };

  const sig = await account.signTypedData({
    domain: accept.extra.eip712.domain,
    types: accept.extra.eip712.types as Parameters<typeof account.signTypedData>[0]['types'],
    primaryType: accept.extra.eip712.primaryType,
    message: authorization,
  });
  ok('signed by', account.address);

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
    payload: { authorization, signature: sig },
  };

  // Round 2: retry with payment
  const r2 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
    },
    body: JSON.stringify(body),
  });

  const result = await r2.json();
  if (!r2.ok) fail(path, r2.status, JSON.stringify(result, null, 2));
  return result;
}

export function getAccounts() {
  const devKey = process.env.DEV_PRIVATE_KEY as `0x${string}`;
  const requesterKey = (process.env.REQUESTER_PRIVATE_KEY ?? devKey) as `0x${string}`;
  const workerKey = (process.env.WORKER_PRIVATE_KEY ?? devKey) as `0x${string}`;

  if (!requesterKey) {
    console.error('Set REQUESTER_PRIVATE_KEY or DEV_PRIVATE_KEY');
    process.exit(1);
  }
  if (!workerKey) {
    console.error('Set WORKER_PRIVATE_KEY or DEV_PRIVATE_KEY');
    process.exit(1);
  }

  return {
    requester: privateKeyToAccount(requesterKey),
    worker: privateKeyToAccount(workerKey),
  };
}
