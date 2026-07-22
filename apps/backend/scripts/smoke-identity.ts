/**
 * Smoke test: ERC-8004 agent identity registration
 *
 * Steps:
 *  1. Check initial status (no identity yet)
 *  2. Register identity via X402 (0.001 USDC)
 *  3. Verify agentId returned
 *  4. Check status again — registered, same agentId
 *  5. Re-register — idempotent (alreadyRegistered: true, same agentId, no duplicate NFT)
 *  6. Concurrent registration race: several devices registering at once must each land
 *     on a distinct, non-null agentId
 */
import {
  getAccounts,
  x402Post,
  get,
  log,
  ok,
  fail,
  randomAccount,
  registerDevice,
  sleep,
} from './_x402';

async function main() {
  const { requester } = getAccounts();
  console.log('\n=== Identity smoke test ===');
  console.log('wallet:', requester.address);

  // ── Step 1: initial status ──────────────────────────────────────────────────
  log('1/6', 'Check initial identity status');
  const status1 = (await get(`/api/identity/status?address=${requester.address}`)) as {
    registered: boolean;
    agentId: string | null;
  };
  ok('registered', status1.registered);
  ok('agentId', status1.agentId);

  if (status1.registered) {
    console.log('\n  ⚠ wallet already registered on-chain; skipping registration step');
  }

  // ── Step 2: register ────────────────────────────────────────────────────────
  log('2/6', 'Register ERC-8004 identity (X402 0.001 USDC)');
  const regResult = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('agentId', regResult.agentId);
  ok('alreadyRegistered', regResult.alreadyRegistered);

  if (!regResult.agentId) fail('register', 200, 'Missing agentId in response');

  // ── Step 3: verify agentId is a non-negative numeric string ───────────────
  // agentId 0 is a legitimate value -- the first-ever registration on a freshly
  // deployed/reset registry gets it, not an error condition.
  log('3/6', 'Validate agentId format');
  const agentIdNum = Number(regResult.agentId);
  if (!Number.isInteger(agentIdNum) || agentIdNum < 0) {
    fail('agentId format', 200, `Expected non-negative integer, got: ${regResult.agentId}`);
  }
  ok('agentId is valid', regResult.agentId);

  // ── Step 4: status should now show registered ───────────────────────────────
  log('4/6', 'Check status after registration');
  const status2 = (await get(`/api/identity/status?address=${requester.address}`)) as {
    registered: boolean;
    agentId: string | null;
  };
  ok('registered', status2.registered);
  ok('agentId', status2.agentId);

  if (!status2.registered) fail('status check', 200, 'Still not registered after registration');
  if (status2.agentId !== regResult.agentId) {
    fail('agentId mismatch', 200, `Expected ${regResult.agentId}, got ${status2.agentId}`);
  }

  // ── Step 5: idempotency ─────────────────────────────────────────────────────
  log('5/6', 'Re-register — should be idempotent');
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

  // ── Step 6: concurrent registration race ────────────────────────────────────
  // Regression coverage for two related bugs surfaced by concurrent registration:
  //  - createServerWallet() (apps/backend/src/lib/wallet.ts): the server wallet signs
  //    on-chain calls for many concurrent requests from this one address, and without a
  //    nonce manager, concurrent calls could read the same pending nonce -- only one
  //    landed, the rest failed with "Nonce provided for the transaction is lower than the
  //    current nonce of the account" and their device's background identity registration
  //    (devices.router.ts) silently failed forever (agentId stuck null).
  //  - contractRegisterIdentity() (apps/backend/src/services/contract.ts): its RPC-lag
  //    fallback re-fetched every log in the block instead of filtering to this call's own
  //    transaction hash, so two registrations landing in the same block could each read
  //    back the OTHER call's Registered event and silently get handed the wrong agentId.
  // Reproduced with 5 concurrent registrations: the first bug left most accounts stuck with
  // no agentId at all; the second (if hit) would give two accounts the SAME agentId instead.
  log('6/6', 'Concurrent registration race: 5 devices registering at once');
  const CONCURRENCY = 5;
  const accounts = Array.from({ length: CONCURRENCY }, () => randomAccount());
  await Promise.all(accounts.map((account) => registerDevice(account)));

  const agentIds = new Map<string, string>();
  for (let attempt = 0; attempt < 15 && agentIds.size < CONCURRENCY; attempt++) {
    if (attempt > 0) await sleep(2000);
    for (const account of accounts) {
      if (agentIds.has(account.address)) continue;
      const raceStatus = (await get(`/api/identity/status?address=${account.address}`)) as {
        agentId: string | null;
      };
      if (raceStatus.agentId) agentIds.set(account.address, raceStatus.agentId);
    }
  }

  const missing = accounts.filter((a) => !agentIds.has(a.address));
  if (missing.length > 0) {
    fail(
      'concurrent registration',
      200,
      `${missing.length}/${CONCURRENCY} accounts never got an agentId (stuck null): ` +
        missing.map((a) => a.address).join(', ')
    );
  }
  ok('every concurrent account got an agentId', Object.fromEntries(agentIds));

  const raceValues = [...agentIds.values()];
  if (new Set(raceValues).size !== raceValues.length) {
    fail(
      'concurrent registration',
      200,
      `Expected ${raceValues.length} distinct agentIds, got duplicates: ${raceValues.join(', ')}`
    );
  }
  ok('all concurrent agentIds distinct', raceValues);

  console.log('\n✓ Identity smoke test passed\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
