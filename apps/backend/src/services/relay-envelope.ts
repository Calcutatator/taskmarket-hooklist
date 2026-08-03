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

const storage = new AsyncLocalStorage<RelayEnvelope>();

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
export function withRelayEnvelope<T>(envelope: RelayEnvelope, fn: () => Promise<T>): Promise<T> {
  return storage.run(envelope, fn);
}

export function currentRelayEnvelope(): RelayEnvelope | undefined {
  return storage.getStore();
}
