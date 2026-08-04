'use client';

// The one mechanism every paid action opts into to handle the in-flight outcome.
//
// Placed in `lib/` beside the transports it wraps (`x402-client.ts`,
// `wallet-sign-action.ts`, `relayed-write-outcome.ts`) rather than in `hooks/`, which holds
// only the viewport hook: the codebase's other domain hooks (`lib/use-read-auth-signature.ts`)
// already live here, and this hook is meaningless without the transport results it consumes.
//
// It exists as a hook rather than a wrapper around the mutation layer because there is no
// single mutation layer to wrap. Paid writes reach the backend three different ways -- x402
// via `payX402Post`, wallet-signed via `signAndPost`, and hand-rolled fetches in the create
// wizard and the winner pickers -- and a wrapper would have to be written three times anyway.
// What every one of them does share is the component-side obligation: mint a stable key before
// the write, hold the in-flight state, poll, and render something other than the form. That is
// what this owns, so an action opts in with three lines instead of reimplementing ADR-0049.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

import { newIdempotencyKey } from '@/lib/api/idempotency';
import { fetchIntentStatus, type FailedWriteOutcome } from '@/lib/api/intent-status';
import { pendingResultOf } from '@/lib/relayed-write-outcome';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';

const POLL_INTERVAL_MS = 5000;
// Two minutes of polling. Past that the honest answer is "still not settled", not a longer
// wait dressed up as progress -- and never a retry control, because a retry is a second
// payment rather than a second attempt (ADR-0049 point 4).
const MAX_POLLS = 24;

export type InFlightWriteState = {
  idempotencyKey: string;
};

export type { FailedWriteOutcome } from '@/lib/api/intent-status';

export type UseInFlightWrite = {
  /**
   * Stable for the lifetime of the mounted component, minted before any write is attempted.
   * Pass it to the transport so one logical write keeps one key: a viewer who presses the
   * button again presents the write the backend already has rather than buying a second one
   * (ADR-0052). It exists before the request is sent, so it survives a response that never
   * arrived -- which is why it, and not a transaction hash, is the handle.
   */
  idempotencyKey: string;
  /** Non-null once a write has come back in flight. Render the notice instead of the form. */
  state: InFlightWriteState | null;
  /** True once polling has run its course without the effect appearing. */
  stalled: boolean;
  /**
   * Non-null once the intent has been read as failed. Pass it to the notice, which then says
   * what happened instead of continuing to say "not yet".
   */
  failure: FailedWriteOutcome | null;
  /**
   * Returns true when the result was in flight and has been taken over by this hook, in which
   * case the caller must return immediately without touching its error state. Returning a
   * boolean rather than exposing the branch is deliberate: it makes "handled" the caller's
   * early exit, so an in-flight outcome cannot fall through into an error path that offers a
   * retry.
   */
  capture: (result: {
    ok: boolean;
    pending?: boolean;
    idempotencyKey?: string;
    error?: string;
  }) => boolean;
};

/**
 * @param toastMessage Shown once when the write goes in flight. Use the same words as the
 * heading the notice renders, so the transient and the persistent surface agree.
 */
export function useInFlightWrite(toastMessage: string): UseInFlightWrite {
  const router = useRouter();
  const { address } = useAccount();
  const [state, setState] = useState<InFlightWriteState | null>(null);
  const [stalled, setStalled] = useState(false);
  const [failure, setFailure] = useState<FailedWriteOutcome | null>(null);

  // Not `autoStart`. A wallet prompt on the mere presence of a button would be intolerable, so
  // the signature is requested only once a write has actually gone in flight -- at which point
  // the user is already waiting and a one-off approval buys them a real answer. It is one
  // prompt for the session, not one per poll and not one per action: the read-auth message
  // carries no nonce, so `useReadAuthSignatureState` reuses whatever is already cached for
  // this wallet, including a signature some other surface collected earlier.
  const readAuth = useReadAuthSignatureState(address, { autoStart: false });
  const { requestSignature } = readAuth;

  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = newIdempotencyKey();
  }

  // Read through refs so nothing that changes mid-wait re-runs the polling effect. A signature
  // arriving would otherwise hand the user a fresh two-minute budget they have already partly
  // spent, and a router object that is a new identity on every render would restart the
  // interval on every render -- silently multiplying both the refresh rate and the poll rate.
  const readAuthReadyRef = useRef(false);
  readAuthReadyRef.current = readAuth.ready;
  const routerRef = useRef(router);
  routerRef.current = router;
  // Terminal, so the effect must not resume polling if it is ever re-created.
  const failureRef = useRef<FailedWriteOutcome | null>(null);
  failureRef.current = failure;

  useEffect(() => {
    if (!state || !address) return;
    requestSignature();
  }, [state, address, requestSignature]);

  useEffect(() => {
    if (!state || failureRef.current) return;
    let polls = 0;
    let cancelled = false;
    // Flipped once the intent comes back unreadable: the viewer is not its initiator, so no
    // amount of asking again will change the answer. A third-party-funded submission is the
    // real case -- the payer is the initiator, and the worker watching the page is not. From
    // here the surface degrades to exactly what it did before this read existed.
    let intentReadable = true;

    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        setStalled(true);
        clearInterval(timer);
        return;
      }
      // Re-reads the task on the server. The write is confirmed exactly when its effect
      // appears on the task, at which point the surface owning this hook stops rendering.
      // Kept even when the intent is readable: the intent says what happened, the refresh is
      // what makes the result visible on the page.
      routerRef.current.refresh();

      if (!intentReadable || !readAuthReadyRef.current) return;
      void fetchIntentStatus(state.idempotencyKey).then((result) => {
        if (cancelled) return;
        if (result.kind === 'unreadable') {
          intentReadable = false;
          return;
        }
        // `unavailable` is a question that could not be put, not an answer. Ask again next
        // tick rather than treating a dropped request as news about the write.
        if (result.kind !== 'status') return;
        if (result.status.status === 'failed') {
          setFailure({
            reason: result.status.terminalReason,
            refund: result.status.refund ?? null,
          });
          clearInterval(timer);
          return;
        }
        if (result.status.status === 'completed') {
          // Settled and successful. One last refresh brings the effect onto the page, and
          // there is nothing further to wait for.
          clearInterval(timer);
          routerRef.current.refresh();
        }
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state]);

  function capture(result: {
    ok: boolean;
    pending?: boolean;
    idempotencyKey?: string;
    error?: string;
  }): boolean {
    const pending = pendingResultOf(result);
    if (!pending) return false;
    setState({ idempotencyKey: pending.idempotencyKey });
    toast.info(toastMessage);
    return true;
  }

  return { idempotencyKey: idempotencyKeyRef.current, state, stalled, failure, capture };
}
