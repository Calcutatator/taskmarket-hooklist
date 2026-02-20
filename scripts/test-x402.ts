/**
 * X402 smoke test — signs a TransferWithAuthorization with DEV_PRIVATE_KEY
 * and creates a task on the local backend.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/test-x402.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';

async function main() {
const PRIVATE_KEY = process.env.DEV_PRIVATE_KEY as `0x${string}`;
const API_URL = process.env.API_URL || 'http://localhost:3000';

if (!PRIVATE_KEY) {
  console.error('DEV_PRIVATE_KEY not set');
  process.exit(1);
}

const body = {
  description: 'Write a poem about Base L2',
  reward: '1000000', // 1 USDC
  duration: 24,
  mode: 'contest',
  tags: ['poetry'],
};

console.log('Step 1: Hitting /api/tasks to get 402 payment requirements...');

const res1 = await fetch(`${API_URL}/api/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (res1.status !== 402) {
  console.error('Expected 402, got', res1.status, await res1.text());
  process.exit(1);
}

const requirements = await res1.json();
const accept = requirements.accepts[0];
console.log('  network:', accept.network);
console.log('  asset:  ', accept.asset);
console.log('  amount: ', accept.amount, '(', Number(accept.amount) / 1e6, 'USDC )');
console.log('  payTo:  ', accept.payTo);

// Build EIP-712 TransferWithAuthorization message
const account = privateKeyToAccount(PRIVATE_KEY);
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: accept.payTo,
  value: accept.amount,
  validAfter: String(now - 600),
  validBefore: String(now + accept.maxTimeoutSeconds),
  nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
};

console.log('\nStep 2: Signing EIP-712 TransferWithAuthorization...');
console.log('  signer:', account.address);

const signature = await account.signTypedData({
  domain: accept.extra.eip712.domain,
  types: accept.extra.eip712.types,
  primaryType: accept.extra.eip712.primaryType,
  message: authorization,
});

console.log('  sig:', signature.slice(0, 20) + '...');

// Build the X402 v2 payment payload
const payload = {
  x402Version: 2,
  resource: requirements.resource,
  accepted: accept,
  payload: {
    authorization,
    signature,
  },
};

const paymentSignature = Buffer.from(JSON.stringify(payload)).toString('base64');

console.log('\nStep 3: Retrying request with PAYMENT-SIGNATURE header...');

const res2 = await fetch(`${API_URL}/api/tasks`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-SIGNATURE': paymentSignature,
  },
  body: JSON.stringify(body),
});

const result = await res2.json();
console.log('\nStatus:', res2.status);
console.log('Response:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
