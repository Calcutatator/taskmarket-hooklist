/**
 * Smoke test: ERC-8004 agent identity registration
 *
 * Steps:
 *  1. Check initial status (no identity yet)
 *  2. Register identity via X402 (0.001 USDC)
 *  3. Verify agentId returned
 *  4. Check status again — registered, same agentId
 *  5. Re-register — idempotent (alreadyRegistered: true, same agentId, no duplicate NFT)
 */
import { getAccounts, x402Post, get, log, ok, fail } from './_x402';

async function main() {
  const { requester } = getAccounts();
  console.log('\n=== Identity smoke test ===');
  console.log('wallet:', requester.address);

  // ── Step 1: initial status ──────────────────────────────────────────────────
  log('1/5', 'Check initial identity status');
  const status1 = (await get(
    `/api/identity/status?address=${requester.address}`
  )) as { registered: boolean; agentId: string | null };
  ok('registered', status1.registered);
  ok('agentId', status1.agentId);

  if (status1.registered) {
    console.log('\n  ⚠ wallet already registered on-chain; skipping registration step');
  }

  // ── Step 2: register ────────────────────────────────────────────────────────
  log('2/5', 'Register ERC-8004 identity (X402 0.001 USDC)');
  const regResult = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('agentId', regResult.agentId);
  ok('alreadyRegistered', regResult.alreadyRegistered);

  if (!regResult.agentId) fail('register', 200, 'Missing agentId in response');

  // ── Step 3: verify agentId is a non-zero numeric string ───────────────────
  log('3/5', 'Validate agentId format');
  const agentIdNum = Number(regResult.agentId);
  if (!Number.isInteger(agentIdNum) || agentIdNum <= 0) {
    fail('agentId format', 200, `Expected positive integer, got: ${regResult.agentId}`);
  }
  ok('agentId is valid', regResult.agentId);

  // ── Step 4: status should now show registered ───────────────────────────────
  log('4/5', 'Check status after registration');
  const status2 = (await get(
    `/api/identity/status?address=${requester.address}`
  )) as { registered: boolean; agentId: string | null };
  ok('registered', status2.registered);
  ok('agentId', status2.agentId);

  if (!status2.registered) fail('status check', 200, 'Still not registered after registration');
  if (status2.agentId !== regResult.agentId) {
    fail('agentId mismatch', 200, `Expected ${regResult.agentId}, got ${status2.agentId}`);
  }

  // ── Step 5: idempotency ─────────────────────────────────────────────────────
  log('5/5', 'Re-register — should be idempotent');
  const regResult2 = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('alreadyRegistered', regResult2.alreadyRegistered);
  ok('agentId (same)', regResult2.agentId);

  if (!regResult2.alreadyRegistered) {
    fail('idempotency', 200, 'Expected alreadyRegistered: true on second call');
  }
  if (regResult2.agentId !== regResult.agentId) {
    fail('agentId changed', 200, `Expected ${regResult.agentId}, got ${regResult2.agentId}`);
  }

  console.log('\n✓ Identity smoke test passed\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
