import { getCurrentIdempotencyKey } from './idempotency.js';

/**
 * The CLI's success envelope. `idempotencyKey` sits beside `data`, not inside it: `data` is the
 * backend's own response shape and agents parse it by field, so putting a client-side value
 * there would change a payload the caller did not ask to change. At the envelope level it is
 * additive, exactly as `status` was on the failure side, and it lets an operator reconciling
 * logs afterwards match a successful write to the key it was recorded under. Read-only commands
 * mint no key, so they emit the envelope they always did.
 */
export function printResult(data: unknown): void {
  const idempotencyKey = getCurrentIdempotencyKey();
  console.log(
    JSON.stringify({ ok: true, data, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) })
  );
}

/**
 * The CLI's failure envelope.
 *
 * `idempotencyKey` is the handle the operator is left holding when a write fails: the intent id
 * that names the write is minted by the backend and only ever reaches the caller in the response
 * a failure destroys, so the key the client chose before sending is the only identifier that
 * survives. Most commands call this with a bare message string, so the key cannot arrive as an
 * argument; it is read from the async scope the write ran in instead, since the transport is the
 * only layer that knows the key. A scope in which two writes overlapped reports nothing rather
 * than risk naming the sibling write -- see lib/idempotency.ts.
 *
 * This does not make an automatic retry safe. Every failure still renders identically, so a
 * script still cannot tell an in-flight write from a rejected one, and a plain re-run mints a
 * fresh key and is therefore a second operation. What the key buys is a deliberate
 * re-presentation by a human who has decided that is the right move.
 */
export function printError(message: string, options?: { idempotencyKey?: string }): never {
  const idempotencyKey = options?.idempotencyKey ?? getCurrentIdempotencyKey();
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: message,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    }) + '\n'
  );
  process.exit(1);
}
