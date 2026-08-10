// Implements: ADR-0053
import type { HealthResponse } from '@taskmarket/shared';

/**
 * The stale-intent count as of the last worker pass that managed to compute it.
 *
 * A module of its own, holding one value, because of who has to touch it. The counter is
 * produced by the relayed-intent worker and consumed by `/api/health`, and neither should have
 * to import the other: a router that imported the worker would pull the whole sweep graph --
 * dispatch, settlement, the RPC gateway -- into every test that renders a health response, and a
 * worker that imported the router would be worse. A leaf module both sides depend on keeps the
 * dependency pointing one way from each of them.
 *
 * It exists at all because health is polled. The count was previously read straight from the
 * database on every request, which made a public, unauthenticated endpoint cost a query per
 * call -- an amplification any client could aim at us, on the one endpoint whose job is to keep
 * answering while the service is under strain. Publishing it from a sweep that was already
 * reading these same rows makes the cost proportional to the sweep interval instead of to
 * inbound traffic, and adds no timer that did not already exist.
 */
type StaleIntentSnapshot = NonNullable<HealthResponse['intents']>;

let snapshot: StaleIntentSnapshot | undefined;

/**
 * Record what the latest completed sweep found.
 *
 * `measuredAt` travels with the number rather than being left implicit, and that pairing is the
 * point of publishing a cache at all. A bare `0` is ambiguous in exactly the way that matters:
 * it reads identically whether nothing is stuck right now or the worker died an hour ago with
 * nothing stuck at the time. With the timestamp attached, a consumer can see the age of the
 * answer and decide for itself -- a graph can drop stale points, an alert can fire on the cache
 * going cold, which is itself a real signal that the sweep stopped running.
 */
export function publishStaleIntentSnapshot(input: {
  measuredAt?: Date;
  staleNonTerminal: number;
}): void {
  snapshot = {
    measuredAt: (input.measuredAt ?? new Date()).toISOString(),
    staleNonTerminal: input.staleNonTerminal,
  };
}

/**
 * The published snapshot, or `undefined` if no sweep has produced one.
 *
 * `undefined` covers three situations that are the same situation from a caller's side -- the
 * process has not run its first sweep yet, the worker is not running in this process at all, or
 * every pass so far failed to compute the count. In all three there is no answer, and the
 * endpoint says so by omitting the field, which is the convention this response already uses
 * (see `HealthResponseSchema`): absence under an optional field rather than a sentinel nobody
 * remembers not to plot.
 */
export function readStaleIntentSnapshot(): StaleIntentSnapshot | undefined {
  return snapshot;
}

/** Drop the published snapshot. For tests, which must not inherit one another's value. */
export function clearStaleIntentSnapshot(): void {
  snapshot = undefined;
}
