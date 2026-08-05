// Implements: ADR-0045, ADR-0050, ADR-0052
// Implements: ADR-0049
import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { type ApiErrorEnvelope, IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { relayedIntents, serverWalletTransactions, type RelayedIntent } from '../db/schema';
import { apiError } from '../lib/api-error';
import { logger } from '../lib/logger';
import { newRelayEnvelope, type RelayEnvelope } from './relay-envelope';

type Db = typeof DbType;

/**
 * The envelope this intent's transaction must carry, on every attempt.
 *
 * Falls back to a fresh one only for a row written before the columns existed; a stored
 * envelope is always preferred, because reusing it is the entire point.
 */
export function relayEnvelopeForIntent(intent: RelayedIntent): RelayEnvelope {
  if (!intent.relayValidBefore || !intent.relayReceiptNonce) return newRelayEnvelope();
  return {
    receiptNonce: intent.relayReceiptNonce as `0x${string}`,
    validBefore: BigInt(intent.relayValidBefore),
  };
}

/**
 * Operation kinds that can be recorded as a durable intent.
 *
 * A closed union rather than a free string: the completion registry is keyed on it, and a
 * kind with no handler is a startup error rather than a runtime surprise discovered when a
 * receipt lands an hour late and there is nothing to run.
 */
export type RelayedIntentOperation =
  | 'tasks.create'
  | 'tasks.assignEvaluator'
  | 'tasks.update'
  | 'tasks.cancel'
  | 'tasks.refundExpired'
  | 'tasks.rejectSubmission'
  | 'acceptance.accept'
  | 'acceptance.acceptSubmissions'
  | 'acceptance.rate'
  | 'bids.submit'
  | 'bids.auctionAccept'
  | 'pitches.submit'
  | 'pitches.select'
  | 'proofs.submit'
  | 'proofs.anchorDeliverable'
  | 'evaluations.evaluate'
  | 'evaluations.appeal'
  | 'evaluations.finalizeVerdict'
  | 'evaluations.resolveDispute'
  | 'evaluations.evaluatorTimeout'
  | 'claims.claim'
  | 'claims.forfeit'
  | 'submissions.submit'
  | 'wallet.withdraw'
  | 'wallet.withdrawDreams'
  | 'identity.register';

export type RelayedIntentStatus = 'recorded' | 'broadcast' | 'completed' | 'failed';

/**
 * A settled x402 payment an intent is answerable for.
 *
 * One object rather than three optional fields, and that is the whole design. Settlement can
 * only refund a payment it can name in full -- it needs the payer to send to, the hash to key
 * the `orphaned_payments` row on, and the amount to transfer -- so any two of the three are
 * worth exactly as much as none of them, while looking from the outside like a payment that
 * is covered. Three independently optional fields let a caller record a hash with no amount
 * and be silently skipped by the sweep; a single object cannot be built that way, so the
 * mistake stops being possible rather than being caught later (ADR-0048, ADR-0050).
 *
 * Build it with `settledPaymentReference` from the x402 middleware, never by hand: the
 * amount must be the one the facilitator settled, not one a router re-derived from a pricing
 * rule it might have got wrong.
 */
export type IntentPaymentReference = {
  /** What the payer was charged, in USDC base units. */
  amount: bigint;
  payer: string;
  /** The settled x402 transfer, and the key `orphaned_payments` deduplicates refunds on. */
  txHash: `0x${string}`;
};

export type RecordIntentInput = {
  db: Db;
  /**
   * The caller's own key for this logical operation (ADR-0052). Typed as possibly absent so
   * that every call site is forced to plumb it through, and rejected at runtime when it is:
   * a relayed write without one is a 400, with no fallback and no per-operation exception.
   */
  idempotencyKey: string | undefined;
  operation: RelayedIntentOperation;
  /**
   * Who the relay acted for. Recorded on every path, paid or free. Where `payment` is also
   * present its payer wins, because that one is the address the facilitator confirmed paid.
   */
  payer?: string;
  /** Present exactly when the request was charged; absent on every free relayed write. */
  payment?: IntentPaymentReference;
  payload: unknown;
};

/**
 * RFC-4122 shape, and nothing beyond shape.
 *
 * Checking the form is not the same as deriving meaning from the value -- nothing is parsed
 * out of it, and it is stored and matched exactly as sent. The check earns its place because
 * the column is globally unique: a caller sending `1` would be staking a claim on a name any
 * other caller might also pick, and the collision would surface as a rejected write rather
 * than as anything the caller could debug. A UUID makes accidental collision negligible.
 */
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireIdempotencyKey(key: string | undefined, operation: string): string {
  if (key && IDEMPOTENCY_KEY_PATTERN.test(key)) return key;
  throw apiError({
    reason: 'idempotency_key_required',
    operation,
    message:
      `${operation} requires an ${IDEMPOTENCY_KEY_HEADER} header carrying a UUID you generate ` +
      'for this operation. Send the same value when retrying the same operation, and a fresh ' +
      'one for a new operation.',
  });
}

/**
 * The idempotency check that has to happen before a payment is settled.
 *
 * `recordRelayedIntent` runs inside the handler, which is far too late on a paid path: x402
 * settles in middleware, so by the time the handler sees a repeated key the caller has already
 * signed and paid for a second authorization. Deduplicating the chain call at that point still
 * leaves a settled payment with nothing to attach to -- an orphaned payment and a refund, which
 * is the double charge the key exists to prevent wearing a different hat.
 *
 * So the paid path asks this first, before any 402 challenge. It runs before the caller is
 * authenticated -- on the challenge round there is not even a payment payload to read a payer
 * from -- so it carries no payment facts: no payer, no amount, no payment transaction hash.
 * `intents.get` is where those are read, and it is payer-scoped.
 *
 * What it does carry is the intent id, the operation and the status, which is exactly what the
 * message has always said in prose. Saying it structurally is not a new disclosure; it is the
 * same disclosure a client can act on. The status in particular is what lets a caller tell a
 * repeated key naming a write still landing from one naming a write that has already failed --
 * without it, `idempotency_key_reused` would be as ambiguous as the sentence it replaces
 * (ADR-0058).
 */
export async function checkRelayedWriteIdempotency(input: {
  db: Db;
  key: string | undefined;
}): Promise<{ error: string; status: 400 | 409; envelope: ApiErrorEnvelope } | null> {
  if (!input.key || !IDEMPOTENCY_KEY_PATTERN.test(input.key)) {
    return {
      error:
        `This request requires an ${IDEMPOTENCY_KEY_HEADER} header carrying a UUID you generate ` +
        'for this operation. Send the same value when retrying it, and a fresh one for a new ' +
        'operation.',
      status: 400,
      envelope: { reason: 'idempotency_key_required' },
    };
  }

  const existing = await findIntentByIdempotencyKey(input.db, input.key);
  if (!existing) return null;

  return {
    error: `A ${existing.operation} write for this idempotency key already exists (intent ${existing.id}). It was not charged or submitted again; read its outcome from intents.get.`,
    status: 409,
    envelope: {
      reason: 'idempotency_key_reused',
      intentId: existing.id,
      intentStatus: existing.status as ApiErrorEnvelope['intentStatus'],
      operation: existing.operation,
      idempotencyKey: existing.idempotencyKey,
    },
  };
}

/**
 * An idempotency key for an intent nobody asked for directly.
 *
 * Most intents come from a request and carry the caller's own key. A few are recorded by a
 * completion handler as follow-on work -- an evaluator assignment after a task creation, a
 * deliverable anchor after a proof -- and those have no caller to get a key from.
 *
 * They must not get a random one. Completion is at-least-once by design (ADR-0045): a handler
 * that dies partway through is rerun from the start, and a fresh key on each rerun would
 * record a second follow-on intent and make a second chain call for work already in flight.
 * Deriving the key from the parent intent instead makes the rerun collapse onto the same
 * follow-on, which is what "idempotent handler" was supposed to mean all along.
 *
 * Formatted as a UUID because that is what the column is validated against; the digest is
 * only a way to spread a scope string over that shape, and nothing reads it back out.
 *
 * It has to be a *valid* UUID, not merely a UUID-shaped string. Our own pattern is loose enough
 * that raw digest nibbles passed it, but `z.string().uuid()` -- which any validator on this
 * value could reasonably be written with -- checks the version and variant nibbles, and raw
 * digest nibbles fail it 15 times in 16. So the version is stamped to 4 and the variant to RFC
 * 4122, exactly as a name-based UUID does.
 *
 * Overwriting those six bits does not weaken what this is for. The key is a deterministic name,
 * not a secret and not a uniqueness claim against an adversary: what matters is that the same
 * scope always yields the same key, and a fixed substitution at fixed positions preserves that
 * exactly.
 */
export function derivedIdempotencyKey(scope: string): string {
  const digest = createHash('sha256').update(`taskmarket:intent:${scope}`).digest('hex');
  const version = `4${digest.slice(13, 16)}`;
  // The variant nibble is 8, 9, a or b -- two fixed bits and two taken from the digest.
  const variant = `${'89ab'[parseInt(digest[16], 16) & 0b11]}${digest.slice(17, 20)}`;
  return [digest.slice(0, 8), digest.slice(8, 12), version, variant, digest.slice(20, 32)].join(
    '-'
  );
}

export async function findIntentByIdempotencyKey(
  db: Db,
  key: string
): Promise<RelayedIntent | null> {
  const [row] = await db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

/**
 * Whether a stored intent may be handed back to this caller as their own.
 *
 * The key is globally unique (see the schema for why it is not scoped to the payer), so two
 * callers can in principle name the same intent. Returning one caller's paid intent to
 * another would leak a payer address, an amount and a payment hash, so a key that resolves to
 * someone else's intent is refused rather than reused. The operation is checked for the same
 * reason in reverse: reusing a key across two different operations means the caller has lost
 * track of which write they are retrying, and answering with the wrong one is worse than
 * refusing.
 *
 * The arguments are not checked here -- see `payloadsMatch` for why that is a separate,
 * separately-reported question rather than one more clause in this predicate.
 */
function intentBelongsToCaller(intent: RelayedIntent, input: RecordIntentInput): boolean {
  if (intent.operation !== input.operation) return false;
  const stored = intent.payer?.toLowerCase() ?? null;
  const asking = (input.payment?.payer ?? input.payer)?.toLowerCase() ?? null;
  return stored === asking;
}

/**
 * A payload reduced to one string that two payloads can be compared on (ADR-0061).
 *
 * The comparison this feeds decides whether a repeated key is a retry or a different write,
 * so a false *inequality* here is the expensive direction: it would refuse a legitimate retry
 * and break the recovery path `TASKMARKET_IDEMPOTENCY_KEY` exists to provide. Everything below
 * is chosen to make the incoming payload compare equal to its own stored form.
 *
 * The stored side has already been through `jsonb`, so the rule is simply to put both sides
 * through the same trip the storage takes:
 *
 * - **Key order is erased**, by sorting recursively. `jsonb` does not preserve insertion order,
 *   so two spellings of the same object must not be told apart by it.
 * - **A key present with `undefined` is the same as an absent key.** `JSON.stringify` drops
 *   such entries, so `jsonb` cannot hold the distinction -- keeping it would mean an
 *   `{ a: 1, b: undefined }` payload could never equal its own stored `{ a: 1 }`. In an array
 *   the same value becomes `null`, again matching what the storage does with it.
 * - **A `bigint` becomes its decimal string.** `JSON.stringify` throws on one, so no intent was
 *   ever stored holding one; normalising rather than throwing keeps a caller that passes a
 *   `bigint` where a numeric string is stored comparing equal instead of erroring at compare
 *   time.
 * - `Date` and anything else carrying `toJSON` is serialised the way the storage would.
 *
 * Number precision is the one thing not fully round-trip-safe: `jsonb` keeps an integer wider
 * than 2^53 exactly and `JSON.parse` does not. That is why `bigint` becomes a string rather
 * than a number -- the only realistic way such a value reaches a payload.
 */
export function canonicalizeIntentPayload(value: unknown): string {
  // The literal round trip first, so the incoming side is reduced to exactly the value shape
  // the stored side comes back as, and only then sorted.
  const serialised = JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'bigint' ? entry.toString() : entry
  );
  // `undefined` at the top level does not serialise at all. Payloads are always objects, so
  // this is a guard rather than a case, but it must not throw in `JSON.parse`.
  return stableStringify(serialised === undefined ? null : JSON.parse(serialised));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Whether a repeated key is naming the same write, arguments included (ADR-0061).
 *
 * Worth knowing before reading a payload as though every operation reached here: most do not.
 * On a paid route `checkRelayedWriteIdempotency` refuses a repeated key inside x402Middleware,
 * before the handler runs, so this comparison only ever sees a **free** write --
 * `claims.claim`, `claims.forfeit`, `submissions.submit`, `evaluations.finalizeVerdict`, the
 * two `wallet.withdraw*` operations -- or an intent recorded directly by a service.
 *
 * That is also the whole of what keeps several paid payloads safe. `bids.submit`,
 * `bids.auctionAccept`, `pitches.submit`, `proofs.submit` and `acceptance.rate` all mint a
 * random id, and `bids.auctionAccept` a timestamp and a clock price besides, none of which
 * survives a second attempt unchanged. Nothing in those routers would fail if they were
 * metered free the way RFC-0006 metered `submissions.submit`; they would simply start refusing
 * every honest retry here. Each call site says so, and this is the other end of that thread.
 */
function payloadsMatch(intent: RelayedIntent, input: RecordIntentInput): boolean {
  return canonicalizeIntentPayload(intent.payload) === canonicalizeIntentPayload(input.payload);
}

/**
 * Persist an intent before anything irreversible happens.
 *
 * Ordering is the point: the row exists before the payment is consumed and before the chain
 * call is made, so there is no window where money has moved or a transaction is live with no
 * durable record of what it was for.
 *
 * Idempotency is keyed on the caller's own key, not on anything minted here (ADR-0052). A
 * retried request carrying the same key gets the same intent back rather than a second one
 * and a second chain call. The payment hash keeps its unique index, but as a backstop with a
 * narrower job: one settled payment funds at most one intent, which catches a client that
 * generates a fresh key while reusing a payment it has already spent.
 */
export async function recordRelayedIntent(input: RecordIntentInput): Promise<RelayedIntent> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey, input.operation);

  // Fixed here, once, and replayed verbatim by every broadcast attempt. This is the intent's
  // deadline: a rebroadcast that regenerated it would buy itself another full window on every
  // pass, so the deadline would never arrive and retrying would be unbounded in all but name.
  const envelope = newRelayEnvelope();

  const [row] = await input.db
    .insert(relayedIntents)
    .values({
      id: randomUUID(),
      idempotencyKey,
      operation: input.operation,
      payer: input.payment?.payer ?? input.payer ?? null,
      paymentAmount: input.payment?.amount.toString() ?? null,
      paymentTxHash: input.payment?.txHash ?? null,
      payload: input.payload,
      relayReceiptNonce: envelope.receiptNonce,
      relayValidBefore: envelope.validBefore.toString(),
      status: 'recorded',
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  // The insert is the lookup. Reading first and inserting second would be both slower on the
  // common path and wrong on the uncommon one -- two concurrent first-time requests with the
  // same key would both read nothing and both try to insert -- so the unique index decides
  // and this branch interprets its verdict. Which index it was tells us which mistake the
  // caller made, so it is worth asking rather than answering with one generic conflict.
  const existing = await findIntentByIdempotencyKey(input.db, idempotencyKey);
  if (existing) {
    if (intentBelongsToCaller(existing, input)) {
      // A repeat of the same operation by the same caller with the same arguments: hand back
      // what they already started. That is the whole mechanism.
      if (payloadsMatch(existing, input)) return existing;
      // Same operation, same caller, different arguments -- reachable without a broken client.
      // `TASKMARKET_IDEMPOTENCY_KEY` is the documented recovery path, so an operator takes a
      // key off a failed envelope and re-runs; re-running with a corrected reward or a
      // different task used to hand back the first write and report it as this one's success.
      // The write they just described would never have happened and nothing would have said
      // so, which is worse than any error (ADR-0061).
      throw apiError({
        reason: 'idempotency_key_payload_mismatch',
        operation: input.operation,
        idempotencyKey,
        intentId: existing.id,
        intentStatus: existing.status as ApiErrorEnvelope['intentStatus'],
        message: `The ${IDEMPOTENCY_KEY_HEADER} you sent already names a ${existing.operation} write with different arguments (intent ${existing.id}); the arguments you just sent were not applied. To retry that write, re-send the arguments it was created with. To make a different write, generate a fresh key.`,
      });
    }
    throw apiError({
      reason: 'idempotency_key_conflict',
      operation: input.operation,
      idempotencyKey,
      message: `The ${IDEMPOTENCY_KEY_HEADER} you sent has already been used for a different operation. Generate a fresh one.`,
    });
  }

  if (input.payment) {
    const [settled] = await input.db
      .select()
      .from(relayedIntents)
      .where(eq(relayedIntents.paymentTxHash, input.payment.txHash))
      .limit(1);
    if (settled) {
      // Same payment, fresh key: a retry that failed to reuse its key, or a client replaying
      // a settled payment against a new operation. The payment is spent either way, and the
      // earlier intent is not the write they asked for, so they are told rather than quietly
      // handed it. This is the backstop the payment index now exists for.
      throw apiError({
        reason: 'payment_already_spent',
        intentId: settled.id,
        intentStatus: settled.status as ApiErrorEnvelope['intentStatus'],
        operation: settled.operation,
        idempotencyKey: settled.idempotencyKey,
        message: `This payment has already funded ${settled.operation} (intent ${settled.id}); it cannot fund another write.`,
      });
    }
  }

  // Neither index's row is findable any more -- the colliding intent was deleted between the
  // insert and these reads. Which of the two constraints fired is genuinely unknown here, so the
  // reason names the one thing that is certain: a key that cannot be used again.
  throw apiError({
    reason: 'idempotency_key_conflict',
    operation: input.operation,
    idempotencyKey,
    message: `${input.operation} could not be recorded: its idempotency key or payment is already in use.`,
  });
}

/**
 * Belt-and-braces cap on rebroadcast attempts. Not the real bound.
 *
 * The real bound is the deadline the caller authorised. A relayed call carries a `validBefore`
 * that `TaskMarketForwarder.relay` enforces, and anything a user signed carries its own expiry
 * inside the payload; once chain time passes either, a replay reverts and the intent is failed
 * by contract enforcement rather than by a number somebody had to tune. That is the mechanism
 * to reason about, and the reason a payload is replayed verbatim and never amended: you do not
 * mutate what a user authorised, so an expired authorisation dies and is re-signed.
 *
 * This counter exists only so an intent whose broadcast fails for reasons unrelated to any
 * deadline -- a persistently unreachable RPC, say -- cannot hot-loop the worker forever, and
 * so a paid intent eventually reaches the refund path instead of being retried indefinitely.
 *
 * Set deliberately high enough that it does not bind first. The worker's orphan grace is 30s,
 * so an intent gets at most ~10 attempts inside a 300s receipt window; a cap of 20 sits well
 * clear of that, which is the point -- a cap low enough to end retrying before the deadline
 * would quietly make this constant the real bound again, and tuning it would then be tuning
 * something the payer never agreed to.
 *
 * That argument used to be the *only* thing making the deadline govern, which made it a
 * property of arithmetic rather than of the code: lower this number, or raise the grace, and
 * the cap silently became the governing bound, refunding an intent whose receipt was still
 * valid. `relayDeadlinePassed` below is the structural form of the rule, so the deadline now
 * governs because exhaustion consults it, not because this constant is generously set.
 */
export const MAX_BROADCAST_ATTEMPTS = 20;

/**
 * Has the deadline the caller authorised already passed?
 *
 * The governing bound on retry (ADR-0050 point 5, made structural by ADR-0052).
 * `TaskMarketForwarder.relay` reverts `ReceiptExpired` once chain time is past
 * `validBefore`, and the payload is replayed verbatim, so past that point no attempt can
 * succeed however many attempts remain. Consulting the persisted value directly is what
 * keeps the cap from becoming the real bound the moment somebody tunes it.
 *
 * A row written before the envelope columns existed carries no deadline and is governed by
 * the cap alone -- the only case where that is still true.
 */
function relayDeadlinePassed(nowSeconds: number) {
  return sql`${relayedIntents.relayValidBefore} IS NOT NULL AND ${relayedIntents.relayValidBefore} < ${nowSeconds}`;
}

function nowSecondsOf(now?: Date): number {
  return Math.floor((now?.getTime() ?? Date.now()) / 1000);
}

/**
 * Claim an intent for broadcast.
 *
 * There is no distinct in-flight status to move it to -- `recorded` means "not on chain", and
 * that is still true while a broadcast is being attempted -- so the claim is expressed as a
 * conditional bump of `updatedAt`. The worker's own query skips rows touched within its grace
 * window, which is what keeps an eager dispatch and a worker pass from both spending a nonce
 * on the same intent.
 *
 * The attempt is counted here rather than on success or failure so that a process dying
 * mid-broadcast still consumes one: an attempt that leaves no trace is an attempt that can be
 * repeated forever.
 *
 * `expectedAttempts` makes the claim a compare-and-swap against the counter the caller read.
 * Status alone does not distinguish two claimants: `recorded` stays `recorded` across a
 * broadcast attempt by design, so two passes that listed the same intent in the same window
 * both match on status and both send. The counter is the only field that moves, so requiring it
 * to be untouched since the read is what makes the claim exclusive -- and the second claimant
 * gets null and stops, rather than spending a second nonce on the same work.
 *
 * The attempt cap is deliberately not enforced here. `listUnbroadcastIntents` applies it, which
 * is the right place: it governs *re*broadcasting, and an eager dispatch is the first attempt by
 * design, made by the request that just recorded the intent. Enforcing the cap at the claim
 * would only matter if a caller reached this with an exhausted budget, which is exactly the
 * state `exhaustIntentBroadcastAttempts` uses to mean "hand this to settlement" -- and settlement
 * finds it through that query, not through here.
 */
export async function claimIntentForBroadcast(input: {
  db: Db;
  expectedAttempts: number;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [claimed] = await input.db
    .update(relayedIntents)
    .set({
      broadcastAttempts: sql`${relayedIntents.broadcastAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        eq(relayedIntents.status, 'recorded'),
        // Belt and braces against a caller that reached here with an intent already carrying
        // a hash: a claim is permission to spend a nonce, and a transaction already exists
        // for this work. Every current caller filters on this already; stating it in the
        // predicate makes the claim itself safe rather than safe by virtue of its callers.
        isNull(relayedIntents.txHash),
        eq(relayedIntents.broadcastAttempts, input.expectedAttempts)
      )
    )
    .returning();
  return claimed ?? null;
}

/**
 * Intents that provably never reached the chain and are still worth another attempt.
 *
 * "Provably" is the load-bearing word, and it is why this is safe to run for paid intents too.
 * The outbox row is written when a nonce is allocated, which happens before anything is
 * broadcast, so an intent with no `serverWalletTransactionId` and no `txHash` cannot have a
 * transaction live under it. That is positive evidence of nothing having happened, not an
 * inference from an absent receipt -- the distinction ADR-0045 turns on.
 */
export async function listUnbroadcastIntents(input: {
  db: Db;
  cutoff: Date;
  limit: number;
  now?: Date;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(
      and(
        eq(relayedIntents.status, 'recorded'),
        isNull(relayedIntents.serverWalletTransactionId),
        isNull(relayedIntents.txHash),
        lt(relayedIntents.broadcastAttempts, MAX_BROADCAST_ATTEMPTS),
        // An expired receipt cannot land, so there is nothing worth attempting. The deadline
        // is checked here and not only at the cap so that shortening the cap changes how much
        // we retry, never whether a still-valid receipt is abandoned.
        sql`NOT (${relayDeadlinePassed(nowSecondsOf(input.now))})`,
        lt(relayedIntents.updatedAt, input.cutoff)
      )
    )
    .orderBy(asc(relayedIntents.createdAt))
    .limit(input.limit);
}

/**
 * Hand a claimed intent back for a later attempt after a transient broadcast failure.
 *
 * Rewriting `status` is redundant today (the claim never changed it) and deliberate anyway:
 * this is the one call site that means "nothing reached the chain, try again", and saying so
 * explicitly keeps it correct if the claim ever gains a status of its own.
 */
export async function releaseIntentForRetry(input: { db: Db; intentId: string }): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ status: 'recorded', updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

/** Link the intent to its broadcast transaction. Only confirmed evidence moves it on from here. */
export async function markIntentBroadcast(input: {
  db: Db;
  intentId: string;
  serverWalletTransactionId?: string;
  txHash: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({
      serverWalletTransactionId: input.serverWalletTransactionId ?? null,
      status: 'broadcast',
      txHash: input.txHash,
      updatedAt: new Date(),
    })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Mark an intent broadcast, resolving the outbox row from the transaction hash.
 *
 * The dispatcher hands callers a hash, not the id of the `server_wallet_transactions` row it
 * allocated -- but the reconciler settles by that id, so an intent left without it can never
 * be settled by anything except the request that started it. Looking the row up by hash is
 * what closes that gap, and it is why this is the form request paths should call.
 *
 * The lookup is allowed to fail without taking the hash write down with it. The two writes are
 * not equally important: the outbox id decides *who* settles the intent, while the hash decides
 * whether the intent still looks like one that never reached the chain. `listUnbroadcastIntents`
 * rebroadcasts on exactly that question, so losing the hash because a `select` failed would
 * spend a second nonce on a transaction that is already live. A missing outbox id is recovered
 * by `listConfirmedUnsettledIntents`; a missing hash is recovered by nothing.
 */
export async function linkIntentToBroadcast(input: {
  db: Db;
  intentId: string;
  txHash: string;
}): Promise<void> {
  let serverWalletTransactionId: string | undefined;
  try {
    const [row] = await input.db
      .select({ id: serverWalletTransactions.id })
      .from(serverWalletTransactions)
      .where(eq(serverWalletTransactions.txHash, input.txHash))
      .limit(1);
    serverWalletTransactionId = row?.id;
  } catch (error) {
    logger.error('Outbox lookup for a broadcast relayed intent failed; recording the hash anyway', {
      error: error instanceof Error ? error.message : String(error),
      intentId: input.intentId,
      txHash: input.txHash,
    });
  }

  await markIntentBroadcast({
    db: input.db,
    intentId: input.intentId,
    serverWalletTransactionId,
    txHash: input.txHash,
  });
}

/**
 * Record that an intent's transaction is live, for a caller that has already sent it.
 *
 * The one thing every post-broadcast path must do, and the reason it never throws: once
 * `send` has returned a hash the transaction exists whether or not we manage to write it down,
 * so an error here is not a reason to treat the intent as unsent. The pre-broadcast retry path
 * -- `releaseIntentForRetry`, and the rebroadcast sweep behind it -- is reachable only from a
 * failure that happened *before* a hash existed. Routing a failure from after the hash into it
 * hands `listUnbroadcastIntents` an intent it will read as provably never broadcast and send a
 * second time, which for a paid intent is one payment and two chain calls (ADR-0045, ADR-0050).
 *
 * Failing to persist the hash is still bad -- the intent is then genuinely indistinguishable
 * from an unsent one -- so it is logged at error level rather than swallowed. What the caller
 * must not do is make it worse by reporting the send as not having happened.
 */
export async function persistIntentBroadcast(input: {
  db: Db;
  intentId: string;
  txHash: string;
}): Promise<void> {
  try {
    await linkIntentToBroadcast(input);
  } catch (error) {
    logger.error('Recording the broadcast of a relayed intent failed; the transaction is live', {
      error: error instanceof Error ? error.message : String(error),
      intentId: input.intentId,
      txHash: input.txHash,
    });
  }
}

/**
 * Claim an intent for completion.
 *
 * A single conditional UPDATE, for the same reason the orphaned-payment refund path uses one:
 * the original request and a reconciler pass can both observe the same successful receipt, and
 * without an atomic claim both would run the completion handler. Only one caller's UPDATE
 * matches the row.
 *
 * Returns null when someone else already claimed or finished it.
 */
export async function claimIntentForCompletion(input: {
  db: Db;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [claimed] = await input.db
    .update(relayedIntents)
    .set({
      completionAttempts: sql`${relayedIntents.completionAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        inArray(relayedIntents.status, ['recorded', 'broadcast'])
      )
    )
    .returning();

  return claimed ?? null;
}

/**
 * Retire an intent's remaining rebroadcast attempts without sending anything.
 *
 * For an operation with no registered broadcaster there is no attempt to make: its payload
 * cannot be turned back into a transaction. Spending the budget outright is what keeps such an
 * intent from sitting in `recorded` forever being skipped on every worker pass -- it falls
 * through to the abandoned path, where a paid one is refunded, exactly as it was before
 * rebroadcasting existed.
 */
export async function exhaustIntentBroadcastAttempts(input: {
  db: Db;
  intentId: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ broadcastAttempts: MAX_BROADCAST_ATTEMPTS, updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

export async function markIntentCompleted(input: { db: Db; intentId: string }): Promise<void> {
  const now = new Date();
  await input.db
    .update(relayedIntents)
    .set({ completedAt: now, lastError: null, status: 'completed', updatedAt: now })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Terminal failure. Only the chain may put an intent here -- never a timeout (ADR-0045).
 *
 * `completed` is excluded in the predicate rather than by a read-then-write in the caller,
 * because the race this loses is not hypothetical: a request completing an intent and a
 * reconciler pass reading a replacement's verdict for the same nonce run concurrently, and a
 * check made before the UPDATE is already stale by the time the UPDATE runs. Overwriting a
 * `completed` intent would hide work that demonstrably happened, and on a paid intent it points
 * settlement at a refund for a task the requester already has.
 */
export async function markIntentFailed(input: {
  db: Db;
  intentId: string;
  reason: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ lastError: input.reason.slice(0, 500), status: 'failed', updatedAt: new Date() })
    .where(and(eq(relayedIntents.id, input.intentId), ne(relayedIntents.status, 'completed')));
}

export async function recordIntentCompletionError(input: {
  db: Db;
  intentId: string;
  error: unknown;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await input.db
    .update(relayedIntents)
    .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

export async function getRelayedIntent(input: {
  db: Db;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [row] = await input.db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.id, input.intentId))
    .limit(1);
  return row ?? null;
}

export async function findIntentByTransactionId(input: {
  db: Db;
  serverWalletTransactionId: string;
}): Promise<RelayedIntent | null> {
  const [row] = await input.db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.serverWalletTransactionId, input.serverWalletTransactionId))
    .limit(1);
  return row ?? null;
}

/**
 * Intents whose transaction is confirmed on chain but which have not finished.
 *
 * The reconciler's main pass only ever looks at outbox rows still in `broadcast`, so any row
 * that reached `confirmed` without its intent being completed is invisible to it -- which is
 * exactly what happens when a dispatch awaits its own receipt and the confirmation is recorded
 * before anyone runs the completion. That is a real defect (see dispatchRelayedIntent), and it
 * was undetectable because nothing ever asked this question. Asking it turns "stranded
 * forever" into "completed on the next pass" for any future path that forgets.
 */
export async function listConfirmedUnsettledIntents(input: {
  db: Db;
  limit: number;
}): Promise<RelayedIntent[]> {
  const rows = await input.db
    .select({ intent: relayedIntents })
    .from(relayedIntents)
    .innerJoin(
      serverWalletTransactions,
      eq(serverWalletTransactions.id, relayedIntents.serverWalletTransactionId)
    )
    .where(
      and(
        eq(serverWalletTransactions.status, 'confirmed'),
        // The outbox row must still carry this intent's own transaction. A differing hash means
        // the reconciler replaced a stuck nonce, so what confirmed is a no-op self-transfer and
        // not this work -- sweeping it would complete an intent whose call never landed.
        eq(serverWalletTransactions.txHash, relayedIntents.txHash),
        inArray(relayedIntents.status, ['recorded', 'broadcast'])
      )
    )
    .limit(input.limit);

  return rows.map((row) => row.intent);
}

/**
 * Intents stuck in 'recorded' whose retry is over.
 *
 * Refund is the fallback, not the reflex. An intent that never reached the chain is first
 * retried -- giving the payer the thing they paid for beats giving them their money back --
 * and only once retry is exhausted does it become a write-off. Nothing is live on chain in
 * either case, so a payment here is genuinely refundable.
 *
 * Exhaustion has two forms, and the governing one is the deadline: a receipt the forwarder
 * will now reject cannot be made to land by any number of further attempts. The attempt cap
 * is the belt-and-braces half, bounding resource use rather than correctness (ADR-0050).
 */
export async function listAbandonedIntents(input: {
  db: Db;
  cutoff: Date;
  limit: number;
  now?: Date;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(
      and(
        eq(relayedIntents.status, 'recorded'),
        or(
          gte(relayedIntents.broadcastAttempts, MAX_BROADCAST_ATTEMPTS),
          relayDeadlinePassed(nowSecondsOf(input.now))
        ),
        lt(relayedIntents.updatedAt, input.cutoff)
      )
    )
    .limit(input.limit);
}
