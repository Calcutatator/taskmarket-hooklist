// Reads the status of a relayed write the viewer started (ADR-0049's `intents.get`).
//
// A plain fetch rather than a tRPC React hook on purpose. `useInFlightWrite` is called from
// every paid action -- around fifteen leaves, several of which render outside any query
// provider in isolation -- and a hook would make the tRPC provider a hard requirement of
// every one of them. The read is a single GET with no cache to share, so the hook buys
// nothing here.
//
// Authorization is ADR-0059's: an intent is readable by the address recorded as having
// initiated it, and everyone else gets the same answer as for an id that never existed. The
// read-auth headers (ADR-0023) are picked up from the process-wide cache, so this sends
// whatever the connected wallet has already signed and never drives a signature itself.
import { IntentStatusResponseSchema, type IntentStatusResponse } from '@taskmarket/shared';

import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getCachedReadAuthHeaders } from '@/lib/read-auth';

/**
 * Three answers, because they call for three different behaviours.
 *
 * `unreadable` is the one worth naming: the viewer is not the intent's initiator, which is an
 * ordinary situation rather than an error -- a submission funded by a third party records that
 * payer as the initiator, so the person watching the page is not who may ask. It means "stop
 * asking", not "something went wrong", and the caller degrades to watching for the effect.
 *
 * `unavailable` means the question could not be put -- offline, a 5xx, an unparseable body --
 * and the caller should simply ask again on the next poll.
 */
/**
 * A settled failure, learned from the intent rather than guessed from a page that never changed.
 *
 * Only the failed case has a shape of its own. A completed intent needs none: its effect is on
 * the page by the time it is known, and the surface waiting on it has stopped rendering. The
 * value of the read is telling "still landing" apart from "definitively failed, and here is
 * why", which is the difference between a spinner and an answer.
 *
 * Declared here rather than beside the hook that produces it so the presentational notice can
 * name the type without importing a `"use client"` module.
 */
export type FailedWriteOutcome = {
  /** The backend's terminal reason, verbatim. Null where the failure recorded none. */
  reason: string | null;
  /**
   * Present only where the intent carried a payment that has been written off. Null covers
   * both "no payment was taken" and "no refund has been decided yet", neither of which may be
   * presented as "your money is not coming back".
   */
  refund: { status: 'pending' | 'refunding' | 'refunded' | 'failed'; txHash: string | null } | null;
};

export type IntentStatusResult =
  | { kind: 'status'; status: IntentStatusResponse }
  | { kind: 'unreadable' }
  | { kind: 'unavailable' };

export async function fetchIntentStatus(idempotencyKey: string): Promise<IntentStatusResult> {
  const url = `${getBrowserApiBaseUrl()}/api/intents?idempotencyKey=${encodeURIComponent(
    idempotencyKey
  )}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: getCachedReadAuthHeaders() });
  } catch {
    return { kind: 'unavailable' };
  }

  // Every client-error status collapses to the same answer deliberately. `intent_not_found`
  // covers "not yours" and "no such thing" precisely so the surface cannot be used to discover
  // which idempotency keys exist, and an unauthenticated read (no signature yet, or one the
  // wallet declined) is the same dead end from the page's point of view.
  if (response.status >= 400 && response.status < 500) return { kind: 'unreadable' };
  if (!response.ok) return { kind: 'unavailable' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable' };
  }

  const parsed = IntentStatusResponseSchema.safeParse(body);
  if (!parsed.success) return { kind: 'unavailable' };
  return { kind: 'status', status: parsed.data };
}
