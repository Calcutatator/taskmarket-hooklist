import { cn } from '@/lib/utils';

/**
 * The in-flight outcome of a relayed write (ADR-0049 point 3).
 *
 * Says exactly one thing: the write was submitted and no terminal outcome has been
 * established. It deliberately claims neither success nor failure -- an unconfirmed result is
 * evidence of neither -- and it renders no control at all. **The absence of a retry is the
 * point**, not an omission: for a paid write a retry is a second x402 payment rather than a
 * second attempt, and it is the most expensive mistake available on this platform.
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
  idempotencyKey,
  paid = true,
  stalled,
  subject,
  title,
}: {
  className?: string;
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
  return (
    <div
      aria-live="polite"
      className={cn('grid gap-2 rounded-md border border-border/58 bg-card/38 p-4', className)}
    >
      <p className="flex items-center gap-2 font-mono text-sm text-foreground">
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-primary motion-safe:animate-pulse"
        />
        {title}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        The {subject} was submitted and has not been confirmed on chain yet. This is not a success
        and not a failure: nothing is settled either way until the chain says so. It is being
        watched automatically, so do not submit again --{' '}
        {paid
          ? 'a second submission is a second payment, not a retry.'
          : 'it is already recorded, and a second submission is a second write rather than a retry.'}
      </p>
      <p className="break-all font-mono text-[0.68rem] uppercase text-muted-foreground">
        Reference {idempotencyKey}
      </p>
      {stalled ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Still not settled. Reload this page later, or quote the reference above to support. Do not
          submit the {subject} again.
        </p>
      ) : null}
    </div>
  );
}
