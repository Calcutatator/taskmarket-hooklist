import { isInFlightApiError } from '@taskmarket/shared';

import { ApiError } from './api.js';
import { idempotencyKeyForError } from './idempotency.js';

/**
 * The CLI's success envelope. `idempotencyKey` sits beside `data`, not inside it: `data` is the
 * backend's own response shape and agents parse it by field, so putting a client-side value
 * there would change a payload the caller did not ask to change. At the envelope level it is
 * additive, exactly as `status` was on the failure side, and it lets an operator reconciling
 * logs afterwards match a successful write to the key it was recorded under. Read-only commands
 * mint no key, so they emit the envelope they always did.
 *
 * The key is passed in, from the `WriteOutcome` the write returned. That is the whole of the
 * mechanism: a success envelope can only carry a key the caller got back from a write it just
 * made, so it cannot carry a different write's. A command with nothing to pass -- a read, or a
 * batch whose several writes have no single answer -- emits the envelope without the field, and
 * puts its per-write keys in `data` if they matter.
 */
export function printResult(data: unknown, options?: { idempotencyKey?: string }): void {
  const idempotencyKey = options?.idempotencyKey;
  console.log(
    JSON.stringify({ ok: true, data, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) })
  );
}

/**
 * The one function that turns a failure into the CLI's JSON envelope, for every command and for
 * the top-level handler alike.
 *
 * It is a single function because the alternative was measured. ADR-0058 gave every API error a
 * machine-readable `reason`, and the top-level handler in index.ts learned to publish it as
 * `pending` -- the field a script branches on, where true means the write may still succeed and
 * re-running it is a second payment rather than a retry. But two dozen commands never reached
 * that handler: they caught their own errors and printed `err.message`, which threw the envelope
 * away. Five of them made paid x402 writes, so the classification went missing on exactly the
 * commands where guessing wrong costs money. The rule that a command "should" let the error
 * propagate is the kind of rule this repository has already watched fail three times, so the
 * shape is what enforces it now: there is one renderer, a command inside a `catch` calls it with
 * the error rather than with a message, and
 * `test/unit/config/api-failure-rendering.test.ts` fails the build on any command that does not.
 *
 * What each field is for:
 *
 * - `status` -- the HTTP status, when the failure came from the API at all.
 * - `idempotencyKey` -- the handle the operator is left holding. The intent id that names a write
 *   is minted by the backend and only ever reaches the caller in the response a failure destroys,
 *   so the key the client chose before sending is the only identifier that survives. It is read
 *   off the error itself: from the `ApiError` when the backend answered, and otherwise from the
 *   tag `withIdempotentWrite` puts on anything a write raises, which covers a failure with no
 *   HTTP response behind it -- a signing error, a dropped connection -- that still went out, or
 *   may still go out, under a key that matters. Both routes belong to *this* error, so a batch
 *   that stashes one failure and keeps going still reports the key of the write that failed
 *   rather than of the write that ran last. There is no third route: a key this function cannot
 *   read off the error or take from the caller is a key it does not have, and it says so by
 *   leaving the field out.
 * - the envelope's own fields, spread flat, plus `pending`. Absent entirely when the backend sent
 *   no envelope, rather than defaulted to false: an unclassified failure is not evidence that
 *   nothing is in flight, and a script reading a manufactured `pending: false` would retry on
 *   exactly the outcome it must not. Poll `intents.get` with `intentId`, or with
 *   `idempotencyKey` when the response never arrived.
 */
export function renderFailure(
  error: unknown,
  options?: {
    /** Rendered when the thrown value is not an `Error`, in place of stringifying it. */
    fallback?: string;
    idempotencyKey?: string;
    /** Extra fields a command needs on the envelope, e.g. the per-item outcomes of a batch. */
    details?: Record<string, unknown>;
  }
): void {
  const message = error instanceof Error ? error.message : (options?.fallback ?? String(error));
  const apiError = error instanceof ApiError ? error : undefined;
  const idempotencyKey =
    options?.idempotencyKey ?? apiError?.idempotencyKey ?? idempotencyKeyForError(error);
  const envelope = apiError?.envelope;

  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: message,
      ...(apiError !== undefined ? { status: apiError.status } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(envelope !== undefined ? { ...envelope, pending: isInFlightApiError(envelope) } : {}),
      ...(options?.details ?? {}),
    }) + '\n'
  );
  // `process.exitCode`, not `process.exit`. When stderr is a pipe -- which is exactly how an agent
  // consumes this CLI, `2>&1 | jq` -- Node writes to it asynchronously, and `process.exit` tears
  // the process down without waiting for that write to drain, so the envelope can be truncated or
  // lost entirely. The field most worth not losing is `pending`, the one telling a script whether
  // re-running is a retry or a second payment. Setting the code instead lets the process exit on
  // its own once the write has flushed, with the same status.
  //
  // The cost is that this function returns rather than being `never`, so every caller that renders
  // a terminal failure inside a `catch` must `return` immediately after it -- otherwise control
  // falls through to code that reads a value the failed call never assigned.
  process.exitCode = 1;
}

/**
 * Render a message the CLI composed itself, with no error behind it.
 *
 * This is for a rejection the command decided on its own -- a malformed `--award` spec, an amount
 * that is not a positive number -- where there is no envelope in existence to carry and none is
 * implied. Never call it on a value you caught: a caught error may be an `ApiError`, and printing
 * its message drops the classification a script needs. `renderFailure(err)` is that case, and it
 * renders a locally thrown `Error` identically to this.
 *
 * It returns for the same reason `renderFailure` does, and callers owe it the same `return`.
 */
export function printError(message: string, options?: { idempotencyKey?: string }): void {
  return renderFailure(new Error(message), options);
}

/**
 * Report a failure that does not end the command.
 *
 * Used only where a best-effort side operation failed and the command legitimately carries on to
 * succeed -- `taskmarket init`'s optional email registration is the one case. It lives here rather
 * than at the call site so that the failure envelope is still built in exactly one file; the
 * envelope it writes deliberately omits `pending`, because the command's own outcome is not in
 * question and a `pending` on a line that is not the result would be read as if it were.
 */
export function printWarning(message: string): void {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
}
