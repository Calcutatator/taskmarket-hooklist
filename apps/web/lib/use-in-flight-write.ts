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

import { newIdempotencyKey } from '@/lib/api/idempotency';
import { pendingResultOf } from '@/lib/relayed-write-outcome';

const POLL_INTERVAL_MS = 5000;
// Two minutes of polling. Past that the honest answer is "still not settled", not a longer
// wait dressed up as progress -- and never a retry control, because a retry is a second
// payment rather than a second attempt (ADR-0049 point 4).
const MAX_POLLS = 24;

export type InFlightWriteState = {
  idempotencyKey: string;
};

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
  const [state, setState] = useState<InFlightWriteState | null>(null);
  const [stalled, setStalled] = useState(false);

  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = newIdempotencyKey();
  }

  useEffect(() => {
    if (!state) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        setStalled(true);
        clearInterval(timer);
        return;
      }
      // Re-reads the task on the server. The write is confirmed exactly when its effect
      // appears on the task, at which point the surface owning this hook stops rendering.
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, router]);

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

  return { idempotencyKey: idempotencyKeyRef.current, state, stalled, capture };
}
