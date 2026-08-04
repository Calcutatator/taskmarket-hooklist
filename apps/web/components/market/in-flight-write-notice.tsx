import type { FailedWriteOutcome } from '@/lib/api/intent-status';
import { cn } from '@/lib/utils';

/**
 * What became of the money, on a write that has definitively failed.
 *
 * Five answers, kept apart on purpose, because they ask the user for different things.
 *
 * `refunded` closes the interaction. `pending` and `refunding` mean wait, and are one sentence
 * because the difference between them is internal bookkeeping the user cannot act on. `failed`
 * is the only one that asks the user to go and get help -- and it is exactly the one that would
 * disappear if these were flattened into "not refunded", since "on its way back" and "stuck"
 * read identically that way while demanding opposite responses.
 *
 * The two null cases are different questions, not one. A write that cost nothing was never
 * refundable, so any sentence about a return would describe money that never moved. A paid
 * write with no refund recorded yet has an open question, and silence there would leave the
 * user to guess that the answer is no.
 *
 * The copy says the payment came back, not that a refund transaction was mined. The user's
 * question is about their money; the machinery that moved it is not their concern.
 */
function refundSentence(refund: FailedWriteOutcome['refund'], paid: boolean): string | null {
  if (!refund) {
    if (!paid) return null;
    return 'No decision about your payment has been recorded yet. Quote the reference below to support if it does not come back.';
  }
  switch (refund.status) {
    case 'refunded':
      return 'Your payment has been returned.';
    case 'pending':
    case 'refunding':
      return 'Your payment is on its way back. Nothing further is needed from you.';
    case 'failed':
      return 'Your payment could not be returned automatically, and this will not resolve on its own. Quote the reference below to support.';
  }
}

/**
 * The in-flight outcome of a relayed write (ADR-0049 point 3), and the settled failure it can
 * turn into once the intent is read (ADR-0049 point 2, scoped by ADR-0059).
 *
 * In flight says exactly one thing: the write was submitted and no terminal outcome has been
 * established. It deliberately claims neither success nor failure -- an unconfirmed result is
 * evidence of neither -- and it renders no control at all. **The absence of a retry is the
 * point**, not an omission: for a paid write a retry is a second x402 payment rather than a
 * second attempt, and it is the most expensive mistake available on this platform. The failed
 * state offers no control either, for the same reason: whether trying again is safe depends on
 * whether the money came back, which is a question for a person rather than a button.
 *
 * The idempotency key is shown because it is the handle that outlives the request and
 * identifies the write to support (ADR-0052); a transaction hash is not, since it can be
 * absent and can change when the reconciler lands a replacement at the same nonce.
 *
 * Presentational only -- no state, no wallet, no `"use client"` -- so it renders inside either
 * a Server or a Client Component and is reviewable in isolation without driving a signature.
 * The copy and structure are the ones the evaluator appointment card established; every
 * surface shares them rather than inventing a second vocabulary for the same state.
 */
export function InFlightWriteNotice({
  className,
  failure,
  idempotencyKey,
  paid = true,
  stalled,
  subject,
  title,
}: {
  className?: string;
  /**
   * Set once the write is known to have failed. Replaces the waiting copy outright: the point
   * of reading the intent is that the answer stops being "not yet" and becomes "no, and here
   * is why", so continuing to show a pulse beside it would be the old guess in new clothes.
   */
  failure?: FailedWriteOutcome | null;
  /** The stable handle a user can quote to support. */
  idempotencyKey: string;
  /**
   * Whether resubmitting would spend money again. Paid writes get the blunt warning; a
   * relayed but unpaid write (claim, forfeit) gets the true one rather than a scarier one.
   */
  paid?: boolean;
  /** True once polling has run its course without the effect appearing. */
  stalled?: boolean;
  /** Lower-case noun for this write, e.g. "appointment", "rating". Used mid-sentence. */
  subject: string;
  /** Heading, e.g. "Appointment submitted, confirming". */
  title: string;
}) {
  const refund = failure ? refundSentence(failure.refund, paid) : null;

  return (
    <div
      aria-live="polite"
      className={cn('grid gap-2 rounded-md border border-border/58 bg-card/38 p-4', className)}
    >
      <p className="flex items-center gap-2 font-mono text-sm text-foreground">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            failure ? 'bg-destructive' : 'bg-primary motion-safe:animate-pulse'
          )}
        />
        {failure ? `The ${subject} did not go through` : title}
      </p>
      {failure ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            The {subject} was submitted and has definitively failed, so it is not still on its way.
            It did not take effect.
          </p>
          {/* `break-all`, not `break-words`: a terminal reason routinely ends in an unbroken
              hex string with no break opportunity in it, and on a phone that overflows the
              card sideways rather than wrapping. */}
          {failure.reason ? (
            <p className="break-all text-xs leading-5 text-muted-foreground">
              Reason: {failure.reason}
            </p>
          ) : null}
          {refund ? <p className="text-xs leading-5 text-muted-foreground">{refund}</p> : null}
        </>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          The {subject} was submitted and is not confirmed yet. This is not a success and not a
          failure: nothing is settled either way until it lands. It is being watched automatically,
          so do not submit again --{' '}
          {paid
            ? 'a second submission is a second payment, not a retry.'
            : 'it is already recorded, and a second submission is a second write rather than a retry.'}
        </p>
      )}
      <p className="break-all font-mono text-[0.68rem] uppercase text-muted-foreground">
        Reference {idempotencyKey}
      </p>
      {stalled && !failure ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Still not settled. Reload this page later, or quote the reference above to support. Do not
          submit the {subject} again.
        </p>
      ) : null}
    </div>
  );
}
