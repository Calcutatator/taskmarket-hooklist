/**
 * X402 smoke test — accept a submission (pay 0.001 USDC via X402).
 *
 * Usage:
 *   DEV_PRIVATE_KEY=0x... node_modules/.bin/tsx scripts/test-accept.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';

const TASK_ID   = '0x17506998816fffb9c2becde2b0e84fe9f20626a9d948831cf8e8753d7c791677';
const WORKER    = '0xEA4b0D5ebF46C22e4c7E6b6164706447e67B9B1D';
const API_URL   = process.env.API_URL || 'http://localhost:3000';
const PRIVATE_KEY = process.env.DEV_PRIVATE_KEY as `0x${string}`;

async function main() {
  if (!PRIVATE_KEY) { console.error('DEV_PRIVATE_KEY not set'); process.exit(1); }

  const body = { taskId: TASK_ID, worker: WORKER };

  console.log('Step 1: GET 402 requirements for accept...');
  const res1 = await fetch(`${API_URL}/api/tasks/${TASK_ID}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res1.status !== 402) {
    console.error('Expected 402, got', res1.status, await res1.text());
    process.exit(1);
  }

  const requirements = await res1.json() as any;
  const accept = requirements.accepts[0];
  console.log('  amount:', accept.amount, '(', Number(accept.amount) / 1e6, 'USDC )');
  console.log('  payTo: ', accept.payTo);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from:        account.address,
    to:          accept.payTo,
    value:       accept.amount,
    validAfter:  String(now - 600),
    validBefore: String(now + 3600),
    nonce:       toHex(crypto.getRandomValues(new Uint8Array(32))),
  };

  console.log('\nStep 2: Signing EIP-712 TransferWithAuthorization...');
  const signature = await account.signTypedData({
    domain:      accept.extra.eip712.domain,
    types:       accept.extra.eip712.types,
    primaryType: accept.extra.eip712.primaryType,
    message:     authorization,
  });
  console.log('  sig:', signature.slice(0, 22) + '...');

  const payload = {
    x402Version: 2,
    resource:    requirements.resource,
    accepted: {
      scheme:            accept.scheme,
      network:           accept.network,
      amount:            accept.amount,
      asset:             accept.asset,
      payTo:             accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra:             accept.extra,
    },
    payload: { authorization, signature },
  };

  const paymentSignature = Buffer.from(JSON.stringify(payload)).toString('base64');

  console.log('\nStep 3: POSTing accept with PAYMENT-SIGNATURE...');
  const res2 = await fetch(`${API_URL}/api/tasks/${TASK_ID}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'PAYMENT-SIGNATURE': paymentSignature,
    },
    body: JSON.stringify(body),
  });

  const result = await res2.json();
  console.log('\nStatus:', res2.status);
  console.log('Response:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
