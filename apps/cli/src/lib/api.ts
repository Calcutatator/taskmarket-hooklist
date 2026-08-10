import {
  type ApiErrorEnvelope,
  apiErrorEnvelopeOf,
  buildLegalReceiptHeaders,
  isInFlightApiError,
} from '@taskmarket/shared';

import {
  idempotencyHeaders,
  idempotencyKeyForError,
  rememberIdempotencyKeyFor,
  resolveIdempotencyKey,
  withIdempotentWrite,
} from './idempotency.js';
import { loadKeystore, type Keystore } from './keystore.js';

export const API_URL = process.env.TASKMARKET_API_URL ?? 'https://api.taskmarket.dev';
export const API_ORIGIN = new URL(API_URL).origin;

/**
 * Thrown by apiGet/apiPost/apiDelete on a non-2xx response instead of a bare Error, so the
 * real HTTP status is available structurally (`.status`) rather than only embedded as text
 * inside `.message`. Strictly additive -- `ApiError extends Error`, so existing
 * `catch (err: Error)` call sites keep working unchanged. See
 * apps/cli/src/index.ts's top-level catch, which surfaces `.status` on the CLI's standard
 * JSON error envelope when present.
 */
export class ApiError extends Error {
  readonly status: number;

  /**
   * The idempotency key the failed write was sent under, when the request was a write. This is
   * the only identifier the caller can still hold after a failure -- the intent id is minted by
   * the backend and reaches the caller only in the response the failure destroyed -- so it
   * travels on the error rather than being recoverable from the response. See
   * apps/cli/src/index.ts and lib/output.ts, which surface it on the CLI's JSON envelope.
   */
  readonly idempotencyKey?: string;

  /**
   * The backend's machine-readable classification of the failure (ADR-0058).
   *
   * Before it existed the CLI rendered every failure identically, which is why
   * `docs/CLI_GUIDE.md` had to tell script authors never to auto-retry a paid command: there was
   * no way to tell a write that is still landing from one that was definitively rejected, and
   * retrying the first is a second payment. `reason` is that way.
   *
   * Absent when the backend answered with no envelope -- an older deployment, or a failure that
   * never reached the API at all -- in which case a caller must fall back to the old rule and
   * treat the outcome as unknown rather than as safe to retry.
   */
  readonly envelope?: ApiErrorEnvelope;

  constructor(
    status: number,
    message: string,
    idempotencyKey?: string,
    envelope?: ApiErrorEnvelope
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.idempotencyKey = idempotencyKey;
    this.envelope = envelope;
  }
}

/**
 * Read a failed response's body without letting its shape destroy the failure it describes.
 *
 * `res.json()` on an error path is a trap: a body that is not JSON -- an HTML error page from a
 * proxy, a gateway's plain-text 502, an empty 504 -- makes it throw a `SyntaxError`, and that
 * `SyntaxError` is what propagates instead of the `ApiError` the next few lines were about to
 * build. The status is gone, the idempotency key is gone, and the ADR-0058 envelope is gone,
 * replaced by "Unexpected token < in JSON at position 0". That is the worst possible outcome for
 * a paid write: the failures most likely to arrive as non-JSON are the infrastructure ones, which
 * are exactly the failures most likely to have left a write in flight.
 *
 * Reading text first and parsing defensively means an unparseable body costs the envelope it
 * never had, and nothing else. Round 1 of the x402 exchange already did this; every other path
 * did not.
 */
export async function readFailureBody(res: Response): Promise<{ body: unknown; text: string }> {
  const text = await res.text().catch(() => '');
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch {
    return { body: undefined, text };
  }
}

/** The failure message for a non-2xx response, preserving the shape callers already parse. */
export function failureMessage(
  prefix: string,
  status: number,
  read: { body: unknown; text: string }
): string {
  return `${prefix} (${status}): ${read.body !== undefined ? JSON.stringify(read.body) : read.text}`;
}

/**
 * Prefix a failure's message with what the command was doing, without losing what the failure was.
 *
 * A command that needs to say "the rejections landed but the cancel did not" used to build that
 * sentence with `err.message` and hand the string to `printError`, which is precisely how the
 * envelope went missing. Wrapping preserves `status`, the idempotency key and the ADR-0058
 * envelope on a new `ApiError`, so the added context costs nothing a script was relying on.
 */
export function withErrorContext(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped =
    error instanceof ApiError
      ? new ApiError(error.status, `${context}: ${message}`, error.idempotencyKey, error.envelope)
      : new Error(`${context}: ${message}`);
  // The wrapper is what gets rendered, so it has to inherit the original's idempotency key or the
  // added sentence would cost the caller the handle to the write it is describing. This is the
  // path a batch takes -- it stashes a failure, finishes its remaining writes, and only then
  // wraps and renders -- which is exactly when no ambient answer would be right.
  const key = idempotencyKeyForError(error);
  if (key !== undefined) {
    rememberIdempotencyKeyFor(wrapped, key);
  }
  return wrapped;
}

/** True when a failure is one the backend classified as possibly still landing (ADR-0058). */
export function isPendingApiError(error: unknown): boolean {
  return error instanceof ApiError && isInFlightApiError(error.envelope);
}

export function legalReceiptHeadersForKeystore(
  keystore: Pick<Keystore, 'legalAcceptanceApiOrigin' | 'legalAcceptanceReceipt'>,
  path: string,
  method: 'GET' | 'POST'
): Record<string, string> {
  const canSend =
    keystore.legalAcceptanceApiOrigin === API_ORIGIN &&
    (method === 'POST' || path === '/api/legal/status');
  return canSend ? buildLegalReceiptHeaders(keystore.legalAcceptanceReceipt) : {};
}

async function legalReceiptHeaders(
  path: string,
  method: 'GET' | 'POST'
): Promise<Record<string, string>> {
  try {
    const keystore = await loadKeystore();
    return legalReceiptHeadersForKeystore(keystore, path, method);
  } catch {
    return {};
  }
}

export async function apiGet(
  path: string,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders(path, 'GET');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...legalHeaders,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const read = await readFailureBody(res);
    throw new ApiError(
      res.status,
      failureMessage(`GET ${path} failed`, res.status, read),
      undefined,
      apiErrorEnvelopeOf(read.body) ?? undefined
    );
  }
  return res.json();
}

/**
 * What a write returns: the backend's payload, and the key that write was sent under.
 *
 * The key is returned rather than left somewhere to be looked up, for the same reason it is
 * attached to the `ApiError` a failure raises -- so that whichever outcome the caller ends up
 * reporting, the key it reports came from that outcome. This is the shape the backend already
 * uses on its own side of the same problem: `runRelayedIntent` returns `{ intent, txHash }` and
 * `apiError` puts `idempotencyKey` on the envelope, and neither is ambient.
 */
export interface WriteOutcome<T = unknown> {
  data: T;
  idempotencyKey: string;
}

export async function apiPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  options?: { headers?: Record<string, string>; idempotencyKey?: string }
): Promise<WriteOutcome<T>> {
  const legalHeaders = await legalReceiptHeaders(path, 'POST');
  const idempotencyKey = resolveIdempotencyKey(options?.idempotencyKey);
  return withIdempotentWrite(idempotencyKey, async () => {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...legalHeaders,
        ...idempotencyHeaders(idempotencyKey),
        ...(options?.headers ?? {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const read = await readFailureBody(res);
      throw new ApiError(
        res.status,
        failureMessage(`POST ${path} failed`, res.status, read),
        idempotencyKey,
        apiErrorEnvelopeOf(read.body) ?? undefined
      );
    }
    return { data: (await res.json()) as T, idempotencyKey };
  });
}

export async function apiDelete<T = unknown>(
  path: string,
  options?: { headers?: Record<string, string>; idempotencyKey?: string }
): Promise<WriteOutcome<T>> {
  const legalHeaders = await legalReceiptHeaders(path, 'POST');
  const idempotencyKey = resolveIdempotencyKey(options?.idempotencyKey);
  return withIdempotentWrite(idempotencyKey, async () => {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'DELETE',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...legalHeaders,
        ...idempotencyHeaders(idempotencyKey),
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const read = await readFailureBody(res);
      throw new ApiError(
        res.status,
        failureMessage(`DELETE ${path} failed`, res.status, read),
        idempotencyKey,
        apiErrorEnvelopeOf(read.body) ?? undefined
      );
    }
    return { data: (await res.json()) as T, idempotencyKey };
  });
}
