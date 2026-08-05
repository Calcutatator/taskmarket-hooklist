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
//
// The hook takes the *submission*, not just the key. `submit(run)` mints the key, hands it to
// `run`, and sees every outcome, which is what lets it decide when a key has been spent. The
// earlier shape -- expose `idempotencyKey`, trust each caller to report back through `capture`
// -- put the rule in sixteen components and ten of them got it wrong: after a plain failure the
// form stayed rendered and the next submission, with a different reward or a different worker,
// went out under the failed one's key. Nothing enforced the reporting, so the surfaces that
// forgot looked exactly like the surfaces that did not. Handing over the callback removes the
// question: a component never sees a key and so cannot send under a stale one.

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

/**
 * The shape every transport's result is read through. `payX402Post` and `signAndPost` already
 * return it; a hand-rolled fetch builds it from the response body, using
 * `isPendingWriteResponse` for `pending` rather than a second copy of that judgement.
 */
export type InFlightWriteResult = {
  ok: boolean;
  pending?: boolean;
  idempotencyKey?: string;
  error?: string;
  /** The user declined in their wallet, so nothing was signed, paid, or sent. */
  rejected?: boolean;
};

/**
 * `handled: true` means the write came back in flight and this hook has taken it over: the
 * caller must return immediately without touching its own error state, because an in-flight
 * outcome is not a failure and the surface now renders the notice instead. Otherwise the
 * transport's own result is handed back for the caller to succeed or fail on as usual.
 */
export type SubmitOutcome<R> = { handled: true } | { handled: false; result: R };

export type UseInFlightWrite = {
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
   * Runs one logical write under a key this hook owns.
   *
   * `run` receives the key and must pass it to whichever transport it uses -- and must not
   * hold onto it, since the hook may retire it the moment `run` resolves. A throw from `run`
   * is re-thrown untouched and deliberately retires nothing: see the rotation note in the
   * implementation.
   */
  submit: <R extends InFlightWriteResult>(
    run: (idempotencyKey: string) => Promise<R>
  ) => Promise<SubmitOutcome<R>>;
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

  async function submit<R extends InFlightWriteResult>(
    run: (idempotencyKey: string) => Promise<R>
  ): Promise<SubmitOutcome<R>> {
    const idempotencyKey = idempotencyKeyRef.current!;
    // Not wrapped in try/catch on purpose. A throw out of `run` is an outcome nobody
    // characterised -- a hand-rolled fetch that never returned, a bug mid-flow -- and the only
    // safe reading of "no answer" is the ambiguous one. So it propagates to the caller's own
    // error handling and the key stays put: if the write did land, the retry presents the same
    // key and the backend refuses it before charging anything (ADR-0052 point 5).
    const result = await run(idempotencyKey);

    // The hook supplies the key a transport omitted, so a `pending` outcome can never be
    // demoted to a terminal one -- and therefore never rotated -- for want of a field.
    const pending = pendingResultOf({
      ...result,
      idempotencyKey: result.idempotencyKey ?? idempotencyKey,
    });
    if (pending) {
      setState({ idempotencyKey: pending.idempotencyKey });
      toast.info(toastMessage);
      return { handled: true };
    }

    // Retire the key on every settled outcome, success or failure. The next submission is a
    // new operation -- possibly with a different reward, a different worker, or a different
    // artifact set -- and presenting the previous operation's key for it is how one key comes
    // to name two different writes.
    //
    // THIS IS ONLY SAFE BECAUSE EVERY AMBIGUOUS FAILURE IS REPORTED AS `pending`. `payX402Post`
    // and `signAndPost` each flip a `dispatched` flag the instant the request leaves the
    // browser and report everything after it -- a thrown fetch, a socket dying mid-body, a
    // `json()` that never parses -- as in flight rather than as a failure. A plain failure that
    // reaches here is therefore either pre-dispatch (nothing was sent, so the key is unspent)
    // or an explicit non-pending verdict from the server (the write is settled, so the key is
    // spent). If anyone ever narrows those pending branches back to "the server said so",
    // rotation turns a network blip into a second payment and this line has to go with it.
    //
    // A wallet rejection is the exception and keeps the key: it is pre-dispatch by construction
    // -- nothing signed, nothing paid, nothing sent -- so pressing the button again is a retry
    // of the same operation, which is the reuse ADR-0052 exists to allow.
    if (!result.rejected) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    return { handled: false, result };
  }

  return { state, stalled, failure, submit };
}
