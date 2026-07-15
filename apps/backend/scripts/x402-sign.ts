#!/usr/bin/env tsx
/**
 * x402-sign — Sign and send an X402-protected API request using DEV_PRIVATE_KEY.
 *
 * Usage:
 *   tsx scripts/x402-sign.ts <METHOD> <PATH> [body-json]
 *
 * Environment:
 *   DEV_PRIVATE_KEY     Hex private key of the signing wallet (0x...)
 *   TASKMARKET_API_URL  Backend base URL (default: http://localhost:3000)
 *
 * Examples:
 *   # Create a task
 *   DEV_PRIVATE_KEY=0x... tsx scripts/x402-sign.ts POST /api/tasks \
 *     '{"description":"Write a poem","reward":"1000000","duration":24,"mode":"contest","tags":["poetry"]}'
 *
 *   # Accept a submission
 *   DEV_PRIVATE_KEY=0x... tsx scripts/x402-sign.ts POST /api/tasks/0xTASK_ID/accept \
 *     '{"taskId":"0xTASK_ID","worker":"0xWORKER_ADDRESS"}'
 *
 *   # Rate a task
 *   DEV_PRIVATE_KEY=0x... tsx scripts/x402-sign.ts POST /api/tasks/0xTASK_ID/rate \
 *     '{"taskId":"0xTASK_ID","worker":"0xWORKER_ADDRESS","rating":5}'
 */
import { privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';

const API_URL = process.env.TASKMARKET_API_URL || process.env.API_URL || 'http://localhost:3000';
const PRIVATE_KEY = process.env.DEV_PRIVATE_KEY as `0x${string}`;

async function main() {
  const [method, path, bodyRaw] = process.argv.slice(2);

  if (!method || !path) {
    console.error('Usage: x402-sign.ts <METHOD> <PATH> [body-json]');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('DEV_PRIVATE_KEY not set');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const body = bodyRaw ? JSON.parse(bodyRaw) : undefined;
  const url = `${API_URL}${path}`;

  // Round 1: get payment requirements
  const r1 = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (r1.status !== 402) {
    const text = await r1.text();
    console.error(`Expected 402 Payment Required, got ${r1.status}:`);
    console.error(text);
    process.exit(1);
  }

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
  console.error(`Payment required: ${Number(accept.amount) / 1e6} USDC -> ${accept.payTo}`);

  // Build + sign EIP-712 TransferWithAuthorization
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

  console.error(`Signed with ${account.address}`);

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
    method,
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const result = await r2.json();

  if (!r2.ok) {
    console.error(`Request failed (${r2.status}):`);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  // Output JSON result to stdout (for piping)
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
