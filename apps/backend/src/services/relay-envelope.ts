// Implements: ADR-0045, ADR-0050
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/** Receipt validity window for relay calls (5 minutes). */
export const RELAY_VALID_WINDOW_SECS = 300;

/**
 * The envelope `TaskMarketForwarder.relay` checks: a deadline and a one-shot receipt nonce.
 *
 * Ours, not the caller's -- the user's own signed material sits inside the call data and is
 * never touched by any of this. But it being ours is exactly why it has to be pinned rather
 * than regenerated: it is the only bound on how long a relayed intent stays retryable, and
 * the temptation to "just refresh it" on a retry would quietly remove that bound.
 */
export type RelayEnvelope = {
  receiptNonce: `0x${string}`;
  validBefore: bigint;
};

export function newRelayEnvelope(now: () => number = Date.now): RelayEnvelope {
  return {
    receiptNonce: `0x${randomBytes(32).toString('hex')}`,
    validBefore: BigInt(Math.floor(now() / 1000) + RELAY_VALID_WINDOW_SECS),
  };
}

/**
 * How the intent layer hears about the nonce its relay call is allocated.
 *
 * Ambient for the same reason the envelope is: the thirty-odd `contract*` functions between an
 * intent and the forwarder have no business knowing about intents, and there is exactly one
 * reader (`relayThroughForwarderResult`) and one writer (the intent broadcast path).
 *
 * The link has to be written when the nonce is allocated rather than when the send returns,
 * because "no outbox row and no hash" is the evidence every sweep refunds on, and a send that
 * never answered produces neither while its transaction mines (ADR-0069).
 */
export type RelayOutboxLink = {
  /**
   * `receiptHash` is the forwarder's `consumedReceipts` key for the call about to go out
   * (ADR-0071). It travels with the link rather than being written separately because it is
   * needed under exactly the same circumstances and at exactly the same moment: an intent whose
   * send never answers has no hash to settle by, and this is the only per-intent handle that
   * survives it. Recomputing it later is impossible -- `pgtrSender`, `paymentAmount` and the
   * selector exist only inside the broadcast path -- so it is persisted before the send or not
   * at all.
   *
   * Optional so a caller that has no forwarder call to make (the direct-send operations) is
   * representable rather than having to invent a value.
   */
  onAllocated: (transactionId: string, receiptHash?: `0x${string}`) => Promise<void>;
  onReleased: () => Promise<void>;
};

type RelayContext = { envelope: RelayEnvelope; outboxLink?: RelayOutboxLink };

const storage = new AsyncLocalStorage<RelayContext>();

/**
 * Pin the relay envelope for the duration of one broadcast attempt.
 *
 * Ambient rather than a parameter on purpose. Roughly thirty `contract*` functions sit between
 * an intent and the forwarder, none of which have any business knowing about intents; threading
 * an envelope through all of them would put the rule in thirty places to be forgotten in one.
 * Here there is a single reader, `relayThroughForwarderResult`, and a single writer, the intent
 * broadcast path -- so "an intent always replays its own envelope" is a property of two
 * functions rather than a convention thirty call sites have to keep.
 *
 * Callers outside the intent mechanism bind nothing and get a fresh envelope, which is right:
 * a one-shot call with no durable record has nothing to replay.
 */
export function withRelayEnvelope<T>(
  envelope: RelayEnvelope,
  fn: () => Promise<T>,
  outboxLink?: RelayOutboxLink
): Promise<T> {
  return storage.run({ envelope, outboxLink }, fn);
}

export function currentRelayEnvelope(): RelayEnvelope | undefined {
  return storage.getStore()?.envelope;
}

/** The outbox link bound for this broadcast, or undefined outside the intent mechanism. */
export function currentRelayOutboxLink(): RelayOutboxLink | undefined {
  return storage.getStore()?.outboxLink;
}
