// Implements: ADR-0045, ADR-0050, ADR-0052
// Implements: ADR-0049
import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { type ApiErrorEnvelope, IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { relayedIntents, serverWalletTransactions, type RelayedIntent } from '../db/schema';
import { apiError, intentStatusOf } from '../lib/api-error';
import { logger } from '../lib/logger';
import { newRelayEnvelope, type RelayEnvelope, type RelayOutboxLink } from './relay-envelope';
import { recordUnattachedPayment } from './orphaned-payments';

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

export type RelayedIntentStatus = 'reserved' | 'recorded' | 'broadcast' | 'completed' | 'failed';

/**
 * The operation a reservation carries until its handler says what it really is.
 *
 * Deliberately outside `RelayedIntentOperation`, and that is the guard rather than a cosmetic
 * choice: the completion registry is keyed on that union, so a value outside it can never
 * resolve to a handler. A reservation therefore cannot be completed by any code path even if
 * something contrives to hand it to one, which is a second lock on top of `status = 'reserved'`
 * being excluded from every broadcast query (ADR-0067).
 *
 * The middleware genuinely does not know the operation. It is mounted per route and could be
 * told, but the value it was told would then have to agree with the one the router later
 * records, and a disagreement would refuse an honest caller. The handler is the authority, so
 * the reservation waits for it rather than guessing.
 */
export const RESERVED_OPERATION = 'x402.reservation';

/**
 * How long a claimed-but-unpaid key stays claimed.
 *
 * Bounded by what the payment exchange itself allows: the 402 challenge advertises
 * `maxTimeoutSeconds: 300`, so a client that is going to pay has done so well inside five
 * minutes. Ten gives that room twice over while keeping the window in which an abandoned
 * challenge holds someone's key short.
 *
 * Since the claim moved onto the paying round (ADR-0068) this is housekeeping rather than a
 * defence: a reservation is only written by a request that already carries a signed
 * authorization, and it is either filled or released within that same request. What remains for
 * the TTL is the case the write-ahead authorization record was built for -- a process that died
 * between claiming the key and hearing back from the facilitator -- where the row must outlive
 * the request long enough for the sweep to ask the token contract whether the nonce was consumed.
 */
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

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

export type RelayedWriteRefusal = {
  error: string;
  /**
   * 503 is here for the one refusal that is not the caller's fault: the precondition could not
   * be established, so nothing was charged and the same key is safe to present again. A 409
   * would report it as a conflict the caller caused, which is the wrong thing to retry against.
   */
  status: 400 | 409 | 503;
  envelope: ApiErrorEnvelope;
};

/**
 * Refuse a request whose idempotency key could never have been idempotent (ADR-0052).
 *
 * Shape only, and separate from the claim below because the two happen at different moments.
 * A missing or malformed key is rejected before the payment challenge -- charging a caller who
 * cannot retry safely is the outcome the key exists to prevent -- while the claim waits for the
 * round that carries the payment (ADR-0068). Validating is not claiming: this reads nothing and
 * writes nothing.
 */
export function idempotencyKeyRefusal(key: string | undefined): RelayedWriteRefusal | undefined {
  if (key && IDEMPOTENCY_KEY_PATTERN.test(key)) return undefined;
  return {
    error:
      `This request requires an ${IDEMPOTENCY_KEY_HEADER} header carrying a UUID you ` +
      'generate for this operation. Send the same value when retrying it, and a fresh one ' +
      'for a new operation.',
    status: 400,
    envelope: { reason: 'idempotency_key_required' },
  };
}

/**
 * Claim the idempotency key on the round that carries the payment, immediately before
 * settlement (ADR-0067, as amended by ADR-0068).
 *
 * This used to be a read, and the read is what the defect was. `recordRelayedIntent` runs
 * inside the handler, far too late on a paid path: x402 settles in middleware, so by the time
 * the handler sees a repeated key the caller has already signed and paid for a second
 * authorization. Checking first fixed the sequential retry -- but a check is a read, and the
 * write it guards happens after settlement, so between the two there is a window. Two
 * concurrent requests with one key both read nothing, both settle. The second is then correctly
 * refused, after its money has moved.
 *
 * So the check becomes a claim: creating the intent is what reserves the key. The database
 * arbitrates, by the same insert-then-interpret-the-conflict move `recordRelayedIntent` already
 * uses -- not an application-level lock, which could not span two processes and would in any
 * case have to be held across the facilitator round trip. The loser of the race is refused
 * before it is settled, so it is never charged.
 *
 * ADR-0067 placed that claim before the 402 challenge, which was stronger than the argument for
 * it: x402's second round carries the same key as its first, so the exchange's own paying round
 * collided with its own reservation and was refused for the length of the TTL. The claim
 * therefore belongs on the round that can actually be charged -- settlement happens on exactly
 * one round, and that round claims before it settles.
 *
 * The row created is a real intent in a new state: `reserved`, `payment_required = true`, with
 * no payment reference and no operation yet (see `RESERVED_OPERATION`). It is not broadcastable
 * in that state and it expires if nothing fills it.
 *
 * The refusal deliberately carries no payment facts, because it is read by a caller who is not
 * yet authenticated as anybody: it says the key is spoken for and nothing else. The caller reads
 * the outcome from `intents.get`, which is payer-scoped and can safely say more (ADR-0049,
 * ADR-0058).
 */
export async function reserveRelayedWrite(input: {
  db: Db;
  description?: string;
  key: string | undefined;
  now?: Date;
  route?: string;
}): Promise<
  | { refusal: RelayedWriteRefusal; intent?: undefined }
  | { refusal?: undefined; intent: RelayedIntent }
> {
  const invalidKey = idempotencyKeyRefusal(input.key);
  if (invalidKey) return { refusal: invalidKey };
  // `idempotencyKeyRefusal` returning nothing is what establishes this, and it is the only way
  // to reach here; the narrowing is not expressible on its return type.
  const key = input.key as string;

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
  // The envelope is minted here and kept when the handler fills the row, so the deadline the
  // caller is ultimately held to starts at the reservation rather than being reset by it.
  const envelope = newRelayEnvelope();

  const [reserved] = await input.db
    .insert(relayedIntents)
    .values({
      id: randomUUID(),
      idempotencyKey: key,
      operation: RESERVED_OPERATION,
      paymentRequired: true,
      payload: {
        reservation: true,
        route: input.route ?? null,
        description: input.description ?? null,
      },
      relayReceiptNonce: envelope.receiptNonce,
      relayValidBefore: envelope.validBefore.toString(),
      reservedExpiresAt: expiresAt,
      status: 'reserved',
    })
    .onConflictDoNothing()
    .returning();

  if (reserved) return { intent: reserved };

  // The insert lost, so something already holds this key. One case is not a real conflict: a
  // reservation that expired without ever being filled, whose owner is gone. Taking it over is
  // safe *only* when no authorization was ever recorded against it -- a row that names an
  // authorization may correspond to money that moved, and deciding that is the sweep's job,
  // which can ask the token contract rather than guess (ADR-0067).
  const [takenOver] = await input.db
    .update(relayedIntents)
    .set({
      // A fresh identity, because this is a different request's reservation now. The abandoned
      // owner's intent id was never usable for anything -- a reservation has no outcome to
      // read -- so nothing is stranded by retiring it.
      id: randomUUID(),
      payload: {
        reservation: true,
        route: input.route ?? null,
        description: input.description ?? null,
      },
      relayReceiptNonce: envelope.receiptNonce,
      relayValidBefore: envelope.validBefore.toString(),
      reservedExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(relayedIntents.idempotencyKey, key),
        eq(relayedIntents.status, 'reserved'),
        isNull(relayedIntents.paymentAuthNonce),
        lt(relayedIntents.reservedExpiresAt, now)
      )
    )
    .returning();
  if (takenOver) return { intent: takenOver };

  const existing = await findIntentByIdempotencyKey(input.db, key);
  if (!existing) {
    // The colliding row went away between the insert and this read. Refusing is still the safe
    // answer: retrying with the same key will now succeed, and charging on the assumption that
    // it is free is the one outcome that cannot be taken back.
    //
    // `idempotency_check_unavailable`, not `idempotency_key_reused`. The distinction is not
    // cosmetic: `isInFlightApiError` reads a reused-key envelope as in flight only while its
    // `intentStatus` is non-terminal, and there is no status to send here -- the row this
    // refusal is about no longer exists to have one. A reused-key envelope with no status
    // therefore reads as *terminal* to every client that branches on the field rather than the
    // prose, which is the opposite of what the message says, and would send a caller off to
    // start again under a fresh key.
    //
    // `idempotency_check_unavailable` says exactly what happened -- the precondition could not
    // be established, nothing was charged -- and its documented remedy is already "retry with
    // the same key", which is the advice this branch wants to give.
    return {
      refusal: {
        error: 'This idempotency key could not be claimed; retry this request with the same key.',
        status: 503,
        envelope: { reason: 'idempotency_check_unavailable', idempotencyKey: key },
      },
    };
  }

  return {
    refusal: {
      error:
        existing.status === 'reserved'
          ? // Told to poll by key, not by intent id, because on a reservation the key is the
            // only handle that resolves: no payer is recorded yet, so there is no address for
            // the id lookup to authorize against and it answers intent_not_found. The key is
            // echoed on the envelope beside this message, so the instruction is followable.
            `Another request is already using this idempotency key (intent ${existing.id}) and has not finished paying for it. It was not charged again; read its outcome from intents.get by idempotency key.`
          : `A ${existing.operation} write for this idempotency key already exists (intent ${existing.id}). It was not charged or submitted again; read its outcome from intents.get.`,
      status: 409,
      envelope: {
        reason: 'idempotency_key_reused',
        intentId: existing.id,
        intentStatus: intentStatusOf(existing.status),
        operation: existing.operation,
        idempotencyKey: existing.idempotencyKey,
      },
    },
  };
}

/**
 * Write down the authorization we are about to ask the facilitator to settle (ADR-0067).
 *
 * Before the settle call, never after it returns. The case this exists for is the process
 * dying in between: what is left behind is then a reservation that names the exact EIP-3009
 * authorization, so the sweep can ask whether *that nonce* was consumed instead of inferring
 * from the absence of a payment reference. Recording afterwards would be a log line, not a
 * mechanism -- it is precisely the crash that skips it.
 *
 * These columns are a record of an attempt. They are never evidence money moved: the
 * facilitator may reject the authorization, and a client may sign one and abandon the request.
 * Nothing refunds, credits or broadcasts on the strength of them.
 */
export async function recordIntentPaymentAuthorization(input: {
  db: Db;
  amount: string;
  intentId: string;
  nonce: string;
  payer: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({
      paymentAuthAmount: input.amount,
      paymentAuthNonce: input.nonce,
      paymentAuthPayer: input.payer,
      updatedAt: new Date(),
    })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Hand a reservation back when the request it was made for is refused before it pays.
 *
 * A preflight rejection, an expired authorization, a payload that does not match the
 * requirements: in all of these the exchange never began, so holding the key until its TTL runs
 * out would punish a caller for an error we told them about. Releasing it immediately lets them
 * correct and retry with the same key, which is the behaviour the key promises.
 *
 * Conditional on no authorization having been recorded, and that condition is the whole safety
 * argument. Once the settle call has been made, "it threw" does not establish that nothing
 * settled -- a timeout is indistinguishable from a slow success -- so such a row must be left
 * for the sweep, which can ask the token contract a question this code cannot.
 */
export async function releaseUnpaidReservation(input: { db: Db; intentId: string }): Promise<void> {
  await input.db
    .delete(relayedIntents)
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        eq(relayedIntents.status, 'reserved'),
        isNull(relayedIntents.paymentAuthNonce)
      )
    );
}

/**
 * Reservations whose TTL has run out.
 *
 * Returned rather than expired here, because expiry is not a decision this query is allowed to
 * make on its own: a reservation is never expired without first establishing that no payment
 * landed against it, and that check needs the chain (ADR-0067). See `expireStaleReservations`.
 */
export async function listExpiredReservations(input: {
  db: Db;
  limit: number;
  now?: Date;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(
      and(
        eq(relayedIntents.status, 'reserved'),
        lt(relayedIntents.reservedExpiresAt, input.now ?? new Date())
      )
    )
    .orderBy(asc(relayedIntents.createdAt))
    .limit(input.limit);
}

/** Drop a reservation established to have no payment behind it. */
export async function deleteReservation(input: { db: Db; intentId: string }): Promise<void> {
  await input.db
    .delete(relayedIntents)
    .where(and(eq(relayedIntents.id, input.intentId), eq(relayedIntents.status, 'reserved')));
}

/**
 * Retire a reservation whose authorization the token contract says is still unused.
 *
 * Retained, not deleted, and that is the whole change (ADR-0069). `authorizationState` flips
 * when the settlement *mines*, not when the facilitator broadcasts it, so `false` means one of
 * two things -- never submitted, or submitted and sitting in a mempool -- and a hard DELETE
 * treats it as the first. If it was the second, the authorization mines a block later, USDC has
 * moved from the payer to the server wallet, and the `payment_auth_*` write-ahead record that
 * ADR-0067 exists to keep is gone: there is then nothing anywhere saying what that payment was
 * for. The RPC-failure branch of the same sweep already reasons this way ("unanswered is not
 * no"); this holds a definite-looking answer to the same standard.
 *
 * Terminal rather than left `reserved`, so the sweep does not return it on every pass forever.
 * The cost is that the idempotency key stays held: a payer who signed an authorization against
 * that key and walked away cannot reuse it. That is the safe direction -- the key is held
 * because money may yet move against it -- and it is the same trade the consumed branch already
 * makes.
 */
export async function retireUnpaidReservation(input: {
  db: Db;
  intentId: string;
  reason: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ lastError: input.reason.slice(0, 500), status: 'failed', updatedAt: new Date() })
    .where(and(eq(relayedIntents.id, input.intentId), eq(relayedIntents.status, 'reserved')));
}

/**
 * Keep a reservation alive past its TTL, with the reason it could not be expired.
 *
 * For the one case the sweep must not resolve by itself: an authorization that the token
 * contract says was consumed, so money moved, but for which no payment reference was ever
 * attached. Deleting the row would discard the only durable record of what that payment was
 * for, which is the outcome ADR-0067 names as the reason time alone is not evidence.
 */
export async function holdReservationForReview(input: {
  db: Db;
  intentId: string;
  reason: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ lastError: input.reason.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(relayedIntents.id, input.intentId), eq(relayedIntents.status, 'reserved')));
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
 * On a paid route `reserveRelayedWrite` refuses a repeated key inside x402Middleware,
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
/**
 * Run the fill, treating a unique-constraint loss as "no row filled" rather than an error.
 *
 * Only a constraint violation is swallowed. Anything else -- a dropped connection, a syntax
 * error -- still throws, because the caller's fallback path answers a question about
 * *conflicts*, and answering it for a failure that established no conflict would report a
 * spent payment that nothing has evidence of.
 */
async function fillOrNothing(
  db: Db,
  run: (db: Db) => Promise<RelayedIntent[]>
): Promise<RelayedIntent[]> {
  try {
    return await run(db);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return [];
    throw error;
  }
}

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
      // A fresh insert reaching here is a free relayed write. Every paid route reserves its key
      // in x402Middleware first, so it arrives at the branch below with a row already waiting;
      // the only way to insert a new row carrying a payment is a path that settled without
      // reserving, which is a bug worth recording faithfully rather than papering over
      // (ADR-0067).
      paymentRequired: input.payment !== undefined,
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

  /**
   * From here on this request's payment (if it had one) is not going to fund an intent.
   *
   * This function is the only place a payment is ever attached to an intent, and every branch
   * below either hands back a *different* intent -- one funded by a different payment -- or
   * refuses outright. So a payment carried into any of them bought nothing and never will.
   *
   * This used to be reachable by an ordinary concurrent retry: the pre-settlement idempotency
   * check was a *read*, so two requests carrying one key both found it free and both had their
   * authorization settled before either arrived here. ADR-0067 closed that -- the check is now
   * a claim, and the loser is refused in the middleware before it is ever challenged, so no
   * second payment settles.
   *
   * It is kept as a backstop rather than deleted, because the branches below still name real
   * client mistakes (a fresh key reusing an already-spent payment, a key bound to a different
   * caller) and a payment carried into one of them is still money with nothing pointing at it.
   * If this ever fires now, it means something upstream of the reservation failed, and the row
   * is the only trace that would exist -- which is exactly when you want it.
   *
   * Recording, not refunding. Whether a payment is orphaned -- and so whether to send it back
   * -- is a decision ADR-0048 reserves for intent settlement, which is the only place holding
   * confirmed on-chain evidence. What this closes is the case where the payment left no trace
   * of any kind: the row makes it visible to ops and recoverable by hand, and 'pending' is a
   * status no sweep claims, so it moves no money on its own.
   */
  async function recordPaymentThatFundsNothing(reason: string): Promise<void> {
    if (!input.payment) return;
    await recordUnattachedPayment({
      db: input.db,
      payer: input.payment.payer as `0x${string}`,
      amount: input.payment.amount,
      paymentTxHash: input.payment.txHash,
      context: input.operation,
      failureReason: reason,
    });
  }
  // The key may be held by this request's own reservation (ADR-0067). Filling it is what turns
  // a reservation into an intent: the operation, the payload and the settled payment arrive
  // together, and the row leaves `reserved` for `recorded` in the same statement -- so it
  // becomes broadcastable at exactly the moment it becomes paid, never before.
  //
  // No ownership check is needed, and there is nowhere to get one from: whoever holds the key
  // reserved it, because any other request presenting it was refused in the middleware before
  // reaching a handler. The `status = 'reserved'` predicate is what makes that true under
  // concurrency -- a second filler finds the row already `recorded` and matches nothing.
  //
  // The fill can still lose to the payment index: a client that generated a fresh key while
  // reusing a payment it has already spent gets a fresh reservation and then collides on
  // `payment_tx_hash`. That is not a reason to fail obscurely -- the checks below already name
  // it exactly -- so the conflict falls through to them rather than escaping as a raw
  // constraint error.
  const [filled] = await fillOrNothing(input.db, async (database) =>
    database
      .update(relayedIntents)
      .set({
        operation: input.operation,
        payer: input.payment?.payer ?? input.payer ?? null,
        paymentAmount: input.payment?.amount.toString() ?? null,
        paymentTxHash: input.payment?.txHash ?? null,
        payload: input.payload,
        reservedExpiresAt: null,
        status: 'recorded',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayedIntents.idempotencyKey, idempotencyKey),
          eq(relayedIntents.status, 'reserved')
        )
      )
      .returning()
  );
  if (filled) return filled;

  // The insert is the lookup. Reading first and inserting second would be both slower on the
  // common path and wrong on the uncommon one -- two concurrent first-time requests with the
  // same key would both read nothing and both try to insert -- so the unique index decides
  // and this branch interprets its verdict. Which index it was tells us which mistake the
  // caller made, so it is worth asking rather than answering with one generic conflict.
  const existing = await findIntentByIdempotencyKey(input.db, idempotencyKey);
  if (existing) {
    if (existing.status === 'reserved') {
      // The fill matched the row and was rejected, which leaves exactly one explanation: the
      // payment index. `intentBelongsToCaller` below would compare `RESERVED_OPERATION` against
      // the real operation and report a key conflict, which is both wrong and unactionable, so
      // the spent-payment case is named here where it is still knowable.
      if (input.payment) {
        const [settled] = await input.db
          .select()
          .from(relayedIntents)
          .where(eq(relayedIntents.paymentTxHash, input.payment.txHash))
          .limit(1);
        if (settled) {
          throw apiError({
            reason: 'payment_already_spent',
            intentId: settled.id,
            intentStatus: intentStatusOf(settled.status),
            operation: settled.operation,
            idempotencyKey: settled.idempotencyKey,
            message: `This payment has already funded ${settled.operation} (intent ${settled.id}); it cannot fund another write.`,
          });
        }
      }
      throw apiError({
        reason: 'idempotency_key_conflict',
        operation: input.operation,
        idempotencyKey,
        intentId: existing.id,
        intentStatus: 'reserved',
        message: `The ${IDEMPOTENCY_KEY_HEADER} you sent names a reservation that could not be completed (intent ${existing.id}). Generate a fresh one and retry.`,
      });
    }
    if (intentBelongsToCaller(existing, input)) {
      // A repeat of the same operation by the same caller with the same arguments: hand back
      // what they already started. That is the whole mechanism.
      if (payloadsMatch(existing, input)) {
        // The one branch that answers successfully while still leaving a payment unattached,
        // and therefore the one where the loss was completely silent. A retry that re-sent the
        // same payment is not this case -- the payment index would have matched too and this
        // lookup would be that same row -- so the hashes differing is what says a second
        // authorization was settled for a write that is already under way.
        if (input.payment && existing.paymentTxHash !== input.payment.txHash) {
          await recordPaymentThatFundsNothing(
            `A second payment settled for idempotency key ${idempotencyKey}, which already names intent ${existing.id}; this payment funded no write.`
          );
        }
        return existing;
      }
      // Same operation, same caller, different arguments -- reachable without a broken client.
      // `TASKMARKET_IDEMPOTENCY_KEY` is the documented recovery path, so an operator takes a
      // key off a failed envelope and re-runs; re-running with a corrected reward or a
      // different task used to hand back the first write and report it as this one's success.
      // The write they just described would never have happened and nothing would have said
      // so, which is worse than any error (ADR-0061).
      await recordPaymentThatFundsNothing(
        `Idempotency key ${idempotencyKey} was re-sent with different arguments for ${input.operation}; the payment settled for those arguments funded no write.`
      );
      throw apiError({
        reason: 'idempotency_key_payload_mismatch',
        operation: input.operation,
        idempotencyKey,
        intentId: existing.id,
        intentStatus: intentStatusOf(existing.status),
        message: `The ${IDEMPOTENCY_KEY_HEADER} you sent already names a ${existing.operation} write with different arguments (intent ${existing.id}); the arguments you just sent were not applied. To retry that write, re-send the arguments it was created with. To make a different write, generate a fresh key.`,
      });
    }
    await recordPaymentThatFundsNothing(
      `Idempotency key ${idempotencyKey} already names intent ${existing.id}, which belongs to a different caller or operation; the payment settled for this request funded no write.`
    );
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
        intentStatus: intentStatusOf(settled.status),
        operation: settled.operation,
        idempotencyKey: settled.idempotencyKey,
        message: `This payment has already funded ${settled.operation} (intent ${settled.id}); it cannot fund another write.`,
      });
    }
  }

  // Neither index's row is findable any more -- the colliding intent was deleted between the
  // insert and these reads. Which of the two constraints fired is genuinely unknown here, so the
  // reason names the one thing that is certain: a key that cannot be used again.
  await recordPaymentThatFundsNothing(
    `${input.operation} could not be recorded under idempotency key ${idempotencyKey} and the colliding intent is no longer findable; the payment settled for this request funded no write.`
  );
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
 * The outbox row is written when a nonce is allocated *and linked to this intent in the same
 * breath* (ADR-0069), so an intent with no `serverWalletTransactionId` and no `txHash` cannot
 * have a transaction live under it. That is positive evidence of nothing having happened, not
 * an inference from an absent receipt -- the distinction ADR-0045 turns on.
 *
 * The link used to be written when the send *returned*, which made this predicate ask "did a
 * send answer" rather than "was a nonce allocated". The two differ on exactly one branch -- a
 * send whose answer never arrived -- and that branch is the one where the transaction may be
 * mining. The link is only ever taken back off when the dispatcher establishes the nonce is
 * free again, so what remains here is the same claim, now true rather than nearly true.
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

/**
 * Link an intent to the outbox row whose nonce it is about to spend.
 *
 * Called from the dispatcher's allocation hook, before anything is sent. Writes the id and
 * nothing else: the intent is still `recorded` and still has no hash, because none of that has
 * happened yet. What it buys is that every sweep asking "could a transaction be live under this
 * intent" now has a row to find (ADR-0069).
 */
export async function linkIntentToOutboxRow(input: {
  db: Db;
  intentId: string;
  relayReceiptHash?: string;
  serverWalletTransactionId: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({
      // Written in the same statement as the link, because the two are needed together and
      // under the same circumstances: a send that never answers leaves the link as the only
      // evidence a nonce was spent, and this hash as the only evidence of what it did
      // (ADR-0071). Omitted rather than nulled when absent -- a later attempt must never clear
      // a hash an earlier one wrote.
      ...(input.relayReceiptHash ? { relayReceiptHash: input.relayReceiptHash } : {}),
      serverWalletTransactionId: input.serverWalletTransactionId,
      updatedAt: new Date(),
    })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Take the link back off, for a nonce the dispatcher has established is free again.
 *
 * The inverse of the above and reachable from one branch only: the one holding positive
 * evidence that nothing was sent. Scoped to the id it wrote, so a later attempt's link -- this
 * intent may already have allocated another nonce -- is never cleared by a straggler.
 */
export async function unlinkIntentFromOutboxRow(input: {
  db: Db;
  intentId: string;
  serverWalletTransactionId: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ serverWalletTransactionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        eq(relayedIntents.serverWalletTransactionId, input.serverWalletTransactionId)
      )
    );
}

/**
 * The allocation hooks for one intent's broadcast, in the shape the relay path binds.
 *
 * The released half remembers which row the allocated half wrote, so a release can only ever
 * clear its own link. `onReleased` takes no argument because the dispatcher calling it knows
 * only that the nonce went back to the pool, not what was hung off it.
 */
export function intentOutboxLink(db: Db, intentId: string): RelayOutboxLink {
  let allocated: string | null = null;
  return {
    onAllocated: async (serverWalletTransactionId: string, relayReceiptHash?: `0x${string}`) => {
      allocated = serverWalletTransactionId;
      await linkIntentToOutboxRow({ db, intentId, relayReceiptHash, serverWalletTransactionId });
    },
    onReleased: async () => {
      if (!allocated) return;
      await unlinkIntentFromOutboxRow({ db, intentId, serverWalletTransactionId: allocated });
      allocated = null;
    },
  };
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
      // Only ever written when we have one. Overwriting with null would undo the link the
      // allocation hook wrote, which is the one thing standing between an unanswered send and
      // a refund for work that landed (ADR-0069).
      ...(input.serverWalletTransactionId
        ? { serverWalletTransactionId: input.serverWalletTransactionId }
        : {}),
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
 * spend a second nonce on a transaction that is already live. A missing hash is recovered by
 * nothing.
 *
 * A missing outbox id is recovered by `listConfirmedUnsettledIntents`, which reaches the outbox
 * row by hash for that reason. That claim used to be made here while the sweep joined on the id
 * -- so it held only when the id was present, which is the one case it was written for the
 * absence of. An intent stranded that way was invisible to every path there is, permanently.
 * If that sweep is ever narrowed back to the id, this sentence stops being true.
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
    // Joined on the hash, not on the outbox id. The id is the better key but it is the one that
    // can go missing: `linkIntentToBroadcast` writes the hash even when the lookup that would
    // have supplied the id fails, and an intent with a hash and no id was previously invisible
    // to everything -- to `onConfirmed`, which is keyed on the id; to this sweep, when it joined
    // on the id; and to the abandoned sweep, which skips anything carrying a hash. The chain
    // call had succeeded and the row was never written.
    //
    // The hash identifies the outbox row on its own, and the predicate below already required
    // the two hashes to agree, so nothing is loosened by reaching through it instead.
    .innerJoin(serverWalletTransactions, eq(serverWalletTransactions.txHash, relayedIntents.txHash))
    .where(
      and(
        eq(serverWalletTransactions.status, 'confirmed'),
        // The outbox row must still carry this intent's own transaction. A differing hash means
        // the reconciler replaced a stuck nonce, so what confirmed is a no-op self-transfer and
        // not this work -- sweeping it would complete an intent whose call never landed. That is
        // now the join condition itself.
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
/**
 * Intents whose nonce was spent by a transaction nothing can name.
 *
 * The one state ADR-0069 deliberately left open, and the state this query exists to close. An
 * intent arrives here by exactly one route: its send never returned a hash, so the dispatcher's
 * unknown branch kept the nonce reserved (no evidence it was free), and the reconciler later
 * found that nonce occupied and made the outbox row terminal without ever having a hash to read
 * a receipt from. The intent is left `recorded` with a link and no hash.
 *
 * Every other sweep is closed to it, which is why it needed a new one rather than a widened old
 * one: `listUnbroadcastIntents` requires a null link, `listConfirmedUnsettledIntents` joins on a
 * hash it does not have, and `settleAbandonedIntents` explicitly skips anything carrying a link.
 * Widening any of those would have loosened a predicate that other, live states depend on.
 *
 * The outbox row must be terminal *and* hashless. A row still `reserved` or `broadcast` belongs
 * to the reconciler, which is still replacing it and may yet produce a receipt; a row that
 * carries a hash has an answer readable the ordinary way. Only the row that has given up
 * without ever naming a transaction is this state.
 */
/**
 * Non-terminal intents whose own transaction is terminally failed on chain.
 *
 * The general form of a defect that has now been closed three times one door at a time: an
 * outbox row reaches a terminal state while the intent underneath it is left unsettled, so the
 * payer is charged for a write that provably did not happen and nothing ever refunds them. The
 * first two doors were closed inside the reconciler (`settleNonceSpentElsewhere` settling its
 * intent, and pairing every terminal branch with `settleIntent`); the third was a reverted
 * receipt seen inside a dispatch, where the reconciler was never involved at all (ADR-0073).
 *
 * So the rule is stated as a query rather than defended at each branch. Whoever wrote the
 * `failed` row and for whatever reason, the intent under it is settled -- immediately if that
 * writer settled it inline, on the next pass if it did not, crashed, or was deployed over.
 *
 * The hash requirement is the evidence, and it is not decoration. A `failed` outbox row that
 * carries a hash names a transaction the chain has answered for, or one it has established can
 * never mine. A `failed` row with no hash names nothing: its nonce may have been spent by this
 * intent's own transaction, so it is not refundable on this evidence and is deliberately left to
 * `listStrandedIntents`, which asks the chain about the intent's own one-shot receipt instead
 * (ADR-0069, ADR-0071). Never refund on the absence of evidence.
 */
export async function listFailedTransactionIntents(input: {
  db: Db;
  limit: number;
}): Promise<RelayedIntent[]> {
  const rows = await input.db
    .select({ intent: relayedIntents })
    .from(relayedIntents)
    // Joined on the outbox id, not the hash: the intent's own `txHash` is exactly what this
    // population may be missing (a dispatch that threw before persisting it), and the link is
    // written at nonce allocation, before anything is sent.
    .innerJoin(
      serverWalletTransactions,
      eq(serverWalletTransactions.id, relayedIntents.serverWalletTransactionId)
    )
    .where(
      and(
        inArray(relayedIntents.status, ['recorded', 'broadcast']),
        eq(serverWalletTransactions.status, 'failed'),
        isNotNull(serverWalletTransactions.txHash)
      )
    )
    .orderBy(asc(relayedIntents.createdAt))
    .limit(input.limit);

  return rows.map((row) => row.intent);
}

export async function listStrandedIntents(input: {
  cutoff: Date;
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
        eq(relayedIntents.status, 'recorded'),
        isNull(relayedIntents.txHash),
        eq(serverWalletTransactions.status, 'failed'),
        isNull(serverWalletTransactions.txHash),
        lt(relayedIntents.updatedAt, input.cutoff)
      )
    )
    .orderBy(asc(relayedIntents.createdAt))
    .limit(input.limit);

  return rows.map((row) => row.intent);
}

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

/** The statuses an intent can still move on from. Everything else is terminal. */
export const NON_TERMINAL_INTENT_STATUSES = ['reserved', 'recorded', 'broadcast'] as const;

/**
 * How long an intent may sit untouched before it counts as stuck.
 *
 * Taken from `RESERVATION_TTL_MS` (10 minutes) above, tripled. That TTL is the longest window
 * this service allows any intent to sit in one state legitimately -- the reconciler's own
 * `DEFAULT_STUCK_AFTER_MS` (90s) and the 300s receipt window are both shorter, so anything past
 * three reservation lifetimes is past every sweep that was ever going to touch the row. The
 * multiple is there because this number only has to be well clear of normal settlement, not
 * tight: a counter that fires early is a counter people learn to ignore.
 */
export const STALE_INTENT_AFTER_MS = 3 * RESERVATION_TTL_MS;

/**
 * How many intents are non-terminal and have stopped moving -- a count, and nothing else.
 *
 * Reported on the public `/api/health`, so it may say only how many, never which: an id, payer,
 * amount or operation name here would put private facts about somebody else's write on an
 * unauthenticated endpoint (ADR-0059 scopes intent visibility to the payer).
 *
 * Written as a positive `IN` over the non-terminal statuses rather than a `NOT IN` over the
 * terminal ones so that `idx_relayed_intents_status` remains usable: the terminal rows are the
 * bulk of the table over time, and this is polled.
 */
export async function countStaleNonTerminalIntents(input: { db: Db; now?: Date }): Promise<number> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - STALE_INTENT_AFTER_MS);
  const rows = await input.db
    .select({ value: sql<number>`count(*)::int` })
    .from(relayedIntents)
    .where(
      and(
        inArray(relayedIntents.status, [...NON_TERMINAL_INTENT_STATUSES]),
        lt(relayedIntents.updatedAt, cutoff)
      )
    );
  return rows[0]?.value ?? 0;
}
