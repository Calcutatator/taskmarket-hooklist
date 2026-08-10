// Implements: ADR-0071
// Implements: ADR-0045, ADR-0048, ADR-0053, ADR-0069
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { getPublicClient } from '../lib/rpc-gateway';
import { handlePostPaymentFailure, refundDidNotComplete } from './orphaned-payments';
import { releaseIntentGuard } from './relayed-intent-registry';
import {
  listStrandedIntents,
  markIntentCompleted,
  markIntentFailed,
  recordIntentCompletionError,
} from './relayed-intents';
import { relayReceiptWasConsumed } from './relay-receipt';
import type { WalletWithdrawIntentPayload } from './intents/wallet-intents';

/**
 * How long a stranded intent must sit before this sweep looks at it.
 *
 * The same fifteen minutes the abandoned sweep uses, and for the same reason: the reconciler
 * and a still-running request must both have finished with it before anything here draws a
 * conclusion. It doubles as this sweep's log rate limiter -- an intent that cannot be resolved
 * has its `updatedAt` bumped when the reason is recorded, which puts it back out of the window
 * until the cutoff passes again, so a permanently unresolvable row reports itself roughly once
 * per cutoff rather than once per pass.
 */
export const STRANDED_INTENT_CUTOFF_MS = 15 * 60 * 1000;

/**
 * What the chain says about whether this intent's call landed.
 *
 * Three values, not two, and the third is the point. `unknown` covers an unanswered read and an
 * intent with no question to ask, and it is never treated as `absent`: an RPC timeout is not
 * the chain saying "this did not happen". Reading it as one would refund a payer for work they
 * already hold, which is the exact failure ADR-0069 exists to prevent one layer down.
 */
type RelayEffectEvidence = 'absent' | 'landed' | 'unknown';

const AUTHORIZATION_STATE_ABI = [
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * The deadline past which absence becomes evidence.
 *
 * Not a tunable, and not the same field for every operation: it is whatever bound the chain
 * itself enforces on this call. A relayed call carries the envelope's `validBefore`, which
 * `TaskMarketForwarder.relay` reverts `ReceiptExpired` past. A `wallet.withdraw` carries the
 * user's own EIP-3009 `validBefore` inside the authorization they signed, which USDC enforces.
 * Either way, once it passes, no transaction carrying this intent's material can ever be
 * included -- so an effect still absent then is absent permanently.
 *
 * Null when there is no such bound, which keeps the intent non-terminal rather than making
 * absence mean anything. Absence before the deadline is not evidence either: the transaction
 * whose send never answered may still be sitting in a mempool.
 */
function chainEnforcedDeadline(intent: RelayedIntent): bigint | null {
  if (intent.operation === 'wallet.withdraw') {
    const payload = intent.payload as Partial<WalletWithdrawIntentPayload> | null;
    return payload?.validBefore ? BigInt(payload.validBefore) : null;
  }
  return intent.relayValidBefore ? BigInt(intent.relayValidBefore) : null;
}

/**
 * Ask the chain whether this intent's effect is there.
 *
 * Two mechanisms, one shape. Both name the intent's own one-shot material -- the forwarder
 * receipt for a relayed call, the EIP-3009 `(authorizer, nonce)` pair for a withdrawal -- so
 * both answer "did *this* call land" rather than "does something of this shape exist". That
 * distinction is the whole reason a correlation by payload shape and block window was rejected:
 * it finds *an* effect and cannot say it was this one.
 *
 * Every throw becomes `unknown`. There is no branch on which a failed read produces `absent`.
 */
async function readEffectEvidence(intent: RelayedIntent): Promise<RelayEffectEvidence> {
  if (intent.operation === 'wallet.withdraw') {
    const payload = intent.payload as Partial<WalletWithdrawIntentPayload> | null;
    if (!payload?.from || !payload.nonce) return 'unknown';
    try {
      const consumed = (await getPublicClient().readContract({
        abi: AUTHORIZATION_STATE_ABI,
        address: getServerConfig().USDC_TOKEN_ADDRESS as `0x${string}`,
        args: [payload.from as `0x${string}`, payload.nonce as `0x${string}`],
        functionName: 'authorizationState',
      })) as boolean;
      return consumed ? 'landed' : 'absent';
    } catch {
      return 'unknown';
    }
  }

  // No receipt hash, no question. Three populations land here and all three are correctly
  // non-terminal rather than refundable:
  //
  //   - rows written before this column existed, which have no handle on their own effect;
  //   - `wallet.withdrawDreams`, whose `withdrawFor` call on the DREAMS hook carries no
  //     per-intent one-shot marker readable after the fact;
  //   - `identity.register`, likewise, on the ERC-8004 registry.
  //
  // These are a stated gap, not a silent one (ADR-0071). Guessing at them would mean widening
  // the refund rule to cover a case with no evidence behind it, which is the thing this whole
  // mechanism exists to avoid.
  if (!intent.relayReceiptHash) return 'unknown';

  try {
    return (await relayReceiptWasConsumed(intent.relayReceiptHash as `0x${string}`))
      ? 'landed'
      : 'absent';
  } catch (error) {
    // Deliberately not a `false`. See `relayReceiptWasConsumed`.
    logger.warn('Could not read the forwarder receipt for a stranded intent; leaving it alone', {
      error: error instanceof Error ? error.message : String(error),
      intentId: intent.id,
      operation: intent.operation,
    });
    return 'unknown';
  }
}

/**
 * The database this sweep runs against.
 *
 * Injected only so the decision below can be exercised against an isolated migrated Postgres
 * (see test/integration/relayed-intent-stranded.test.ts); every production call site uses the
 * module singleton.
 */
type Database = typeof db;

async function resolveStrandedIntent(database: Database, intent: RelayedIntent): Promise<void> {
  const evidence = await readEffectEvidence(intent);

  if (evidence === 'landed') {
    // The call is on chain. The money question is therefore settled in the only direction it
    // can be: no refund, because the payer has what they paid for.
    //
    // The completion handler is deliberately not run, because it cannot be: every handler is
    // given the transaction hash and several write it to a NOT NULL column, and the hash is
    // precisely what this intent never got back. The chain-derived half of the projection is
    // the indexer's anyway -- it writes the task, claim, submission and proof rows from the
    // events these calls emit, keyed on the hash it reads off the log rather than one we hand
    // it -- so what is actually lost is the off-chain half, which is why this says so out loud
    // rather than completing quietly.
    await markIntentCompleted({ db: database, intentId: intent.id });
    logger.error('A stranded intent landed on chain; completed without running its handler', {
      intentId: intent.id,
      operation: intent.operation,
      reason:
        'the send never returned a transaction hash, so the completion handler had nothing to run against; on-chain state is projected by the indexer',
    });
    return;
  }

  if (evidence === 'unknown') {
    await recordIntentCompletionError({
      db: database,
      error: new Error(
        intent.relayReceiptHash || intent.operation === 'wallet.withdraw'
          ? 'Could not read whether this intent landed on chain; it stays open until the read answers'
          : `Operation ${intent.operation} has no readable per-intent effect, so whether it landed cannot be established; this intent needs manual reconciliation`
      ),
      intentId: intent.id,
    });
    logger.error('A stranded intent cannot be resolved from the chain', {
      hasReceiptHash: Boolean(intent.relayReceiptHash),
      intentId: intent.id,
      operation: intent.operation,
    });
    return;
  }

  const deadline = chainEnforcedDeadline(intent);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (deadline === null || deadline >= nowSeconds) {
    // Absent, but not yet absent *permanently*. The transaction whose send never answered may
    // still be in a mempool, and it can still be included right up to the deadline the chain
    // enforces. Concluding anything here would be reading a timeout as a verdict.
    return;
  }

  // Absent past the deadline the chain itself enforces. No transaction carrying this intent's
  // material can be included from here, so the effect is not late -- it is not coming. This is
  // the same standard ADR-0045 sets for a reverted receipt: the chain has answered, and the
  // answer is that the work did not happen.
  await markIntentFailed({
    db: database,
    intentId: intent.id,
    reason:
      'The transaction sent for this intent never returned a hash, and its effect is absent on chain past the deadline the chain enforces; nothing landed',
  });

  // Safe for the same reason it is safe in the abandoned sweep: the guard exists to stop a
  // signature being replayed while a transaction carrying it might still mine, and past the
  // deadline no such transaction can be included.
  await releaseIntentGuard({ db: database, intent });

  if (!intent.paymentTxHash && !intent.paymentAmount) {
    if (intent.paymentRequired) {
      logger.error('Stranded intent required payment but carries no payment reference', {
        intentId: intent.id,
        operation: intent.operation,
      });
    }
    return;
  }

  if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) {
    logger.error('Stranded intent carries an incomplete payment reference; cannot refund it', {
      hasAmount: Boolean(intent.paymentAmount),
      hasPayer: Boolean(intent.payer),
      hasTxHash: Boolean(intent.paymentTxHash),
      intentId: intent.id,
      operation: intent.operation,
    });
    return;
  }

  try {
    await handlePostPaymentFailure({
      amount: BigInt(intent.paymentAmount),
      context: intent.operation,
      db: database,
      error: new Error('Intent was sent but its effect never appeared on chain'),
      payer: intent.payer as `0x${string}`,
      paymentTxHash: intent.paymentTxHash as `0x${string}`,
    });
  } catch (error) {
    // Always throws by design; only a genuine refund failure matters, read from the structured
    // outcome rather than the prose (ADR-0069).
    if (refundDidNotComplete(error)) {
      logger.error('Refund for a stranded intent did not complete', {
        error: error instanceof Error ? error.message : String(error),
        intentId: intent.id,
        operation: intent.operation,
      });
    }
  }
}

/**
 * Resolve intents whose nonce was spent by a transaction nothing could name.
 *
 * The state ADR-0069 left open on purpose: a send whose connection dropped mid-call, so no hash
 * was ever returned, whose nonce the reconciler later found occupied. It could not be refunded,
 * because the transaction occupying that nonce may have been the intent's own; it could not be
 * completed, because nothing could say that it was.
 *
 * It is resolved by asking about the *effect* rather than the transaction. The forwarder records
 * every receipt it consumes, keyed on a nonce minted once per intent, so "did this call land" is
 * a lookup rather than a search -- the same property that makes the reservation sweep safe
 * (ADR-0067). Three outcomes, and the middle one is why this is safe: the effect is there and
 * the intent completes with no refund; the effect is absent past the deadline the chain enforces
 * and the intent fails and refunds; anything else -- absent but still inside the deadline, an
 * unanswered read, an operation with no readable effect -- leaves the intent exactly as it was.
 */
export async function settleStrandedIntents(
  limit: number,
  options: { database?: Database } = {}
): Promise<void> {
  const database = options.database ?? db;
  const cutoff = new Date(Date.now() - STRANDED_INTENT_CUTOFF_MS);
  for (const intent of await listStrandedIntents({ cutoff, db: database, limit })) {
    try {
      await resolveStrandedIntent(database, intent);
    } catch (error) {
      // One intent must not end the pass; the next one sees it again.
      logger.error('Resolving a stranded intent failed', {
        error: error instanceof Error ? error.message : String(error),
        intentId: intent.id,
      });
    }
  }
}
