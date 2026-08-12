/**
 * Carries wallet history and in-flight reward state from a previous TaskTokenRewardHook to a
 * replacement one, so a hook swap does not cost users anything.
 *
 * Run against a PAUSED protocol, between deploying the new hook and re-pointing the vault at it.
 * Dry-run first; it prints exactly what it would write and sends nothing.
 *
 *   OLD_HOOK=0x... NEW_HOOK=0x... npx tsx src/scripts/migrate-reward-hook-state.ts
 *   OLD_HOOK=0x... NEW_HOOK=0x... npx tsx src/scripts/migrate-reward-hook-state.ts --execute
 *
 * ## Why this exists
 *
 * A replacement hook starts with empty storage, and two mappings matter:
 *
 * - `firstSeen` is the basis for the wallet-age ramp, and `rampMultipliers[0]` is 0. Without
 *   migration every existing wallet looks brand new and earns NOTHING until it ages past the
 *   first threshold again -- two weeks at current settings, then eight to ramp back.
 * - `banned` resets the other way, which is worse: a wallet the owner removed comes back
 *   admitted.
 *
 * A third, `rewardStates`, is the one that costs money rather than rewards. A vault reservation
 * is only ever settled by the hook calling `vault.release`/`vault.pay`, and the hook only does
 * that from a path that reads `rewardStates[taskId]`. A task reserved against the old hook and
 * carried into a hook that does not know it becomes permanently unsettleable: its tokens stay
 * counted in `totalReserved`, and because that figure gates the next swap, one orphaned
 * reservation blocks every future one. That has already happened on testnet -- five reservations
 * orphaned by an earlier cutover, still stuck.
 *
 * ## Why it reads logs rather than a database
 *
 * The set of wallets the hook knows about is not recorded anywhere off-chain: `firstSeen` is
 * written by the hook itself on first interaction, including for wallets that never appear in a
 * task the backend indexed. Reconstructing from the hook's own events is the only source that
 * cannot silently disagree with the contract.
 *
 * Bans are the exception and the reason `WalletBanned`/`WalletUnbanned` were added: a hook
 * deployed before those events has no log trace of a ban at all, so a wallet banned before it
 * ever earned anything is undiscoverable here and must be re-banned by hand. The script reports
 * that gap rather than pretending it covered everything.
 */
import { RewardVaultABI, TaskMarketABI, TaskTokenRewardHookABI } from '@taskmarket/contracts/abi';
import { createPublicClient, createWalletClient, getAddress, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Generated, never hand-written. Every signature in this script was originally transcribed by
// hand and two were wrong: `RewardPaid` found zero events because its parameters did not match,
// and `getTask` failed all 127 requester lookups because the real tuple has fourteen fields in a
// different order. The generated artifacts exist so a signature cannot silently disagree with
// the contract (ADR-0065), and a migration is the last place to relitigate that.

const READ_ABI = TaskTokenRewardHookABI;
const WRITE_ABI = TaskTokenRewardHookABI;
const DIAMOND_ABI = TaskMarketABI;
const VAULT_ABI = RewardVaultABI;

/**
 * Everything this script talks to is already in `.env`, per network. Resolve it from there.
 *
 * The first run of this was invoked with addresses typed on the command line, and the Diamond
 * address was silently the wrong one -- so all 127 requester lookups returned nothing and the
 * script reported the population as having no requesters at all. A wrong address does not throw;
 * an `eth_call` to a contract that is not there just returns empty. The env already holds the
 * right value for each network, so there is no reason for a human to retype one.
 *
 * NETWORK selects the suffix. An explicit override still wins, for pointing at a fork or a
 * freshly deployed hook that is not in `.env` yet.
 */
const EXECUTE = process.argv.includes('--execute');

const NETWORK = (process.env.NETWORK ?? 'mainnet').toLowerCase();
const SUFFIX = NETWORK === 'mainnet' ? '_MAINNET' : '_SEPOLIA';

function fromEnv(override: string | undefined, forgeName: string): string | undefined {
  return override ?? process.env[`FORGE_${forgeName}${SUFFIX}`];
}

const OLD_HOOK = fromEnv(process.env.OLD_HOOK, 'DREAMS_HOOK_ADDRESS') as Address | undefined;
const NEW_HOOK = process.env.NEW_HOOK as Address | undefined;
const VAULT = fromEnv(process.env.VAULT_ADDRESS, 'REWARD_VAULT_ADDRESS') as Address | undefined;
const DIAMOND = fromEnv(process.env.DIAMOND_ADDRESS, 'DIAMOND_ADDRESS') as Address | undefined;

// Prefer the dedicated provider over the public node. The public one rate-limited the first run
// partway through reading wallet state, which is a slow way to learn it was the wrong choice.
// The network-specific URL wins over the generic `BASE_RPC_URL`, which in a typical `.env` points
// at whichever chain that shell was last used for. Getting this backwards pointed mainnet
// addresses at a Sepolia node; it happened to fail on an unknown block, but had the block number
// existed on Sepolia every query would have returned empty and been indistinguishable from a hook
// with no history.
const RPC_URL =
  (NETWORK === 'mainnet' ? process.env.BASE_MAINNET_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL) ??
  process.env.BASE_RPC_URL;

/** Chain the resolved addresses are meant for. Mismatch is always a misconfiguration. */
const EXPECTED_CHAIN_ID = NETWORK === 'mainnet' ? 8453 : 84532;

const OWNER_KEY = (process.env.UPGRADE_OWNER_KEY ??
  process.env[`FORGE_DEV_PRIVATE_KEY${SUFFIX}`] ??
  process.env.FORGE_DEV_PRIVATE_KEY) as `0x${string}` | undefined;

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 100);

/**
 * Retries on the rate limits a public RPC applies to a few hundred sequential calls.
 *
 * The first real run of this script died two thirds of the way through reading wallet state with
 * an HTTP 429 -- after a scan that had already taken minutes. A migration that has to be restarted
 * because it was impolite to the node is a migration someone will be tempted to run half-finished.
 */
async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let delay = 500;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = message.includes('429') || message.toLowerCase().includes('rate limit');
      if (!rateLimited || attempt === 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error(`unreachable: ${label}`);
}

function requireEnv<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === '') {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

/**
 * Scans in windows because public RPCs cap `eth_getLogs` at 10k blocks, and a single wide query
 * fails with an error that reads like an empty result if it is not checked.
 */
async function collectLogs(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  event: (typeof READ_ABI)[number],
  fromBlock: bigint,
  toBlock: bigint
) {
  const WINDOW = 9_999n;
  const out: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (let start = fromBlock; start <= toBlock; start += WINDOW + 1n) {
    const end = start + WINDOW > toBlock ? toBlock : start + WINDOW;
    const logs = await withRetry(
      () => client.getLogs({ address, event: event as never, fromBlock: start, toBlock: end }),
      `getLogs ${start}-${end}`
    );
    out.push(...logs);
  }
  return out;
}

async function main() {
  const oldHook = getAddress(requireEnv(OLD_HOOK, 'OLD_HOOK'));
  const newHook = getAddress(requireEnv(NEW_HOOK, 'NEW_HOOK'));
  const rpcUrl = requireEnv(RPC_URL, 'BASE_RPC_URL');
  const deployBlock = BigInt(
    requireEnv(process.env.OLD_HOOK_DEPLOY_BLOCK, 'OLD_HOOK_DEPLOY_BLOCK')
  );

  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  // Print the resolved target before doing any work. Reading this back is the cheapest way to
  // catch a wrong network or a stale override, and it costs one screen.
  // Assert before scanning. A wrong-chain RPC does not error -- it answers, with nothing -- so
  // this is the difference between aborting and confidently reporting an empty migration.
  const connectedChainId = await publicClient.getChainId();
  if (connectedChainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC is chain ${connectedChainId} but NETWORK=${NETWORK} expects ${EXPECTED_CHAIN_ID}. ` +
        `The addresses resolved from FORGE_*${SUFFIX} would be read against the wrong chain.`
    );
  }

  console.log(`network:  ${NETWORK} (chain ${connectedChainId})`);
  console.log(`old hook: ${oldHook}`);
  console.log(`diamond:  ${DIAMOND ?? '(unset)'}`);
  console.log(`vault:    ${VAULT ?? '(unset)'}`);

  // SCAN_TO_BLOCK bounds the scan, which matters twice: rehearsing over a range known to
  // contain activity, and resuming a run that died partway through a million blocks.
  const head = await publicClient.getBlockNumber();
  const latest = process.env.SCAN_TO_BLOCK ? BigInt(process.env.SCAN_TO_BLOCK) : head;

  // A deploy block earlier than the hook's own deployment scans blocks where the contract did
  // not exist: harmless but silent, and it reads exactly like "this hook has no history". A
  // block after it silently truncates real history, which is worse. Both are easy to hit when
  // several hooks have shared one vault, so check rather than trust the input.
  const codeAtDeploy = await publicClient.getCode({ address: oldHook, blockNumber: deployBlock });
  if (!codeAtDeploy || codeAtDeploy === '0x') {
    console.warn(`WARNING: ${oldHook} has no code at block ${deployBlock}.`);
    console.warn('The scan will start before this hook existed. That is wasteful but safe --');
    console.warn('unless you meant a DIFFERENT hook, in which case you are about to migrate the');
    console.warn('wrong contract. Confirm the address before executing.');
    console.warn('');
  }
  const codeBefore =
    deployBlock > 0n
      ? await publicClient.getCode({ address: oldHook, blockNumber: deployBlock - 1n })
      : undefined;
  if (codeBefore && codeBefore !== '0x') {
    console.warn(`WARNING: ${oldHook} already had code before block ${deployBlock}.`);
    console.warn('History earlier than this block will be MISSED. Lower OLD_HOOK_DEPLOY_BLOCK.');
    console.warn('');
  }

  console.log(`old hook: ${oldHook}`);
  console.log(`new hook: ${newHook}`);
  console.log(`scanning blocks ${deployBlock} .. ${latest}`);
  console.log(EXECUTE ? 'MODE: execute' : 'MODE: dry run (nothing will be sent)');
  console.log('');

  // ── wallets ────────────────────────────────────────────────────────────────
  const wallets = new Set<Address>();
  const addWallet = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('0x') && value.length === 42) {
      wallets.add(getAddress(value));
    }
  };

  for (const eventName of [
    'RewardReserved',
    'RewardPaid',
    'RewardsWithdrawn',
    'WalletBanned',
    'WalletUnbanned',
  ] as const) {
    const abiEvent = READ_ABI.find((e) => e.type === 'event' && e.name === eventName);
    if (!abiEvent) continue;
    const logs = await collectLogs(publicClient, oldHook, abiEvent, deployBlock, latest);
    for (const log of logs) {
      const args = (log as { args?: Record<string, unknown> }).args ?? {};
      for (const value of Object.values(args)) addWallet(value);
    }
    console.log(`  ${eventName}: ${logs.length} log(s)`);
  }

  // Requesters are credited by `_creditWithSplit` and given a `firstSeen` by `checkFund`, but
  // they appear in no hook event as an address -- `RewardPaid` indexes only the worker. They
  // have to be resolved through the Diamond, one task at a time, or every requester silently
  // fails to carry over and loses their entire wallet age.
  const diamondAddress = DIAMOND;
  if (diamondAddress) {
    const configured = READ_ABI.find((e) => e.type === 'event' && e.name === 'RewardConfigured');
    const logs = configured
      ? await collectLogs(publicClient, oldHook, configured, deployBlock, latest)
      : [];
    const taskIds = new Set<string>();
    for (const log of logs) {
      const taskId = (log as { args?: { taskId?: string } }).args?.taskId;
      if (taskId) taskIds.add(taskId);
    }
    console.log(`  RewardConfigured: ${logs.length} log(s), ${taskIds.size} task(s)`);
    let resolved = 0;
    for (const taskId of taskIds) {
      try {
        const task = (await withRetry(
          () =>
            publicClient.readContract({
              abi: DIAMOND_ABI,
              address: getAddress(diamondAddress),
              args: [taskId as `0x${string}`],
              functionName: 'getTask',
            }),
          `getTask(${taskId})`
        )) as { requester?: string } | readonly unknown[];
        // viem returns the struct by name when the ABI names its components, which the
        // generated one does. The positional fallback covers an unnamed tuple.
        const requester = Array.isArray(task)
          ? (task[1] as string | undefined)
          : (task as { requester?: string }).requester;
        if (requester) {
          addWallet(requester);
          resolved += 1;
        }
      } catch {
        // A task the Diamond no longer knows is not fatal -- report the shortfall below rather
        // than aborting a migration over one unreadable row.
      }
    }
    console.log(`  requesters resolved via Diamond: ${resolved}/${taskIds.size}`);
    if (resolved < taskIds.size) {
      console.warn(`  WARNING: ${taskIds.size - resolved} task(s) did not resolve a requester.`);
    }
  } else {
    console.warn('\n  WARNING: DIAMOND_ADDRESS not set -- requesters will NOT be carried over.');
    console.warn('  They are credited rewards and have a firstSeen, but appear in no hook event,');
    console.warn('  so without the Diamond they cannot be discovered. Set it before executing.');
  }

  console.log(`\ndistinct wallets discovered: ${wallets.size}`);

  // Read the authoritative values off the old hook. The logs identify WHO; only the contract
  // knows the actual firstSeen timestamp and current ban state.
  const rows: { wallet: Address; firstSeenAt: number; isBanned: boolean }[] = [];
  for (const wallet of wallets) {
    // Sequential rather than Promise.all: the point is to be gentle on the node, and a pair of
    // parallel calls per wallet across a hundred wallets is what tripped the limiter.
    const firstSeenAt = await withRetry(
      () =>
        publicClient.readContract({
          abi: READ_ABI,
          address: oldHook,
          functionName: 'firstSeen',
          args: [wallet],
        }),
      `firstSeen(${wallet})`
    );
    const isBanned = await withRetry(
      () =>
        publicClient.readContract({
          abi: READ_ABI,
          address: oldHook,
          functionName: 'banned',
          args: [wallet],
        }),
      `banned(${wallet})`
    );
    // 0 is the "never seen" sentinel; seeding it would write the absence of a value, and
    // seedWalletHistory skips it anyway.
    if (Number(firstSeenAt) === 0) continue;
    rows.push({ wallet, firstSeenAt: Number(firstSeenAt), isBanned: Boolean(isBanned) });
  }

  const bannedCount = rows.filter((r) => r.isBanned).length;
  console.log(`wallets with history to carry: ${rows.length} (${bannedCount} banned)`);

  // ── in-flight reward states ────────────────────────────────────────────────
  const vaultAddress = VAULT;
  const inFlight: string[] = [];
  if (vaultAddress) {
    const vault = getAddress(vaultAddress);
    const totalReserved = await publicClient.readContract({
      abi: VAULT_ABI,
      address: vault,
      functionName: 'totalReserved',
    });
    console.log(`\nvault totalReserved: ${totalReserved}`);

    const reserved = new Set<string>();
    const settled = new Set<string>();
    for (const [eventName, target] of [
      ['Reserved', reserved],
      ['Released', settled],
      ['Paid', settled],
    ] as const) {
      const abiEvent = VAULT_ABI.find((e) => e.type === 'event' && e.name === eventName);
      if (!abiEvent) continue;
      const logs = await collectLogs(publicClient, vault, abiEvent as never, deployBlock, latest);
      for (const log of logs) {
        const taskId = (log as { args?: { taskId?: string } }).args?.taskId;
        // payDirect emits taskId 0 for the bounty path -- not a reservation.
        if (taskId && taskId !== `0x${'00'.repeat(32)}`) target.add(taskId);
      }
    }
    for (const taskId of reserved) if (!settled.has(taskId)) inFlight.push(taskId);
    console.log(`in-flight reservations to carry: ${inFlight.length}`);
    if (Number(totalReserved) === 0 && inFlight.length > 0) {
      console.warn('  WARNING: totalReserved is 0 but unsettled Reserved events exist.');
      console.warn('  These are likely orphaned by an EARLIER swap and cannot be carried.');
    }
  } else {
    console.log('\nVAULT_ADDRESS not set -- skipping in-flight reward state.');
    console.log('Set it, or confirm totalReserved() is 0 before cutting over.');
  }

  // ── write ──────────────────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log('\nDry run. Re-run with --execute to send.');
    console.log(`Would send ${Math.ceil(rows.length / BATCH_SIZE)} seedWalletHistory batch(es)`);
    if (inFlight.length) {
      console.log(
        `Would send ${Math.ceil(inFlight.length / BATCH_SIZE)} seedRewardStates batch(es)`
      );
    }
    console.log('\nBans are only discoverable here from WalletBanned/WalletUnbanned events.');
    console.log('A hook deployed before those events existed has no log trace of a ban, so a');
    console.log('wallet banned without ever earning must be re-banned by hand.');
    return;
  }

  const ownerKey = requireEnv(OWNER_KEY, 'UPGRADE_OWNER_KEY (or FORGE_DEV_PRIVATE_KEY)');
  const account = privateKeyToAccount(ownerKey);
  const chainId = await publicClient.getChainId();
  // Minimal chain descriptor rather than an imported one: this script has to run against
  // mainnet, Base Sepolia and a local Anvil, and the id is the only part writeContract needs.
  const chain = {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const hash = await walletClient.writeContract({
      abi: WRITE_ABI,
      account,
      address: newHook,
      args: [
        batch.map((r) => r.wallet),
        batch.map((r) => r.firstSeenAt),
        batch.map((r) => r.isBanned),
      ],
      functionName: 'seedWalletHistory',
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      console.error(`seedWalletHistory batch ${i / BATCH_SIZE} REVERTED: ${hash}`);
      process.exit(1);
    }
    console.log(`  seeded wallets ${i + 1}..${i + batch.length}  ${hash}`);
  }

  for (let i = 0; i < inFlight.length; i += BATCH_SIZE) {
    const batch = inFlight.slice(i, i + BATCH_SIZE);
    const states = await Promise.all(
      batch.map((taskId) =>
        publicClient.readContract({
          abi: READ_ABI,
          address: oldHook,
          args: [taskId as `0x${string}`],
          functionName: 'rewardStates',
        })
      )
    );
    const hash = await walletClient.writeContract({
      abi: WRITE_ABI,
      account,
      address: newHook,
      args: [batch as `0x${string}`[], states as never],
      functionName: 'seedRewardStates',
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      console.error(`seedRewardStates batch ${i / BATCH_SIZE} REVERTED: ${hash}`);
      process.exit(1);
    }
    console.log(`  seeded reward states ${i + 1}..${i + batch.length}  ${hash}`);
  }

  console.log('\nSeeding complete. Spot-check several wallets against the old hook, then call');
  console.log('sealWalletHistory() and sealRewardState() -- both are one-way.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
