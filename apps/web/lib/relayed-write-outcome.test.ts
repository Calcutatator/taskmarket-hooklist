import { describe, expect, it } from 'vitest';

import {
  isPendingTransactionMessage,
  isPendingWriteResponse,
  pendingResultOf,
} from './relayed-write-outcome';

// The envelope is the contract (ADR-0058). These cases are what the UI actually branches on.
describe('isPendingWriteResponse', () => {
  it('reads an in-flight write from the envelope, not from its message', () => {
    // The message here says nothing recognisable. That is the point: the backend is free to
    // reword it, and the client no longer cares.
    expect(
      isPendingWriteResponse(
        { error: 'anything at all', taskmarket: { reason: 'intent_in_flight', intentId: 'i-1' } },
        'anything at all'
      )
    ).toBe(true);
  });

  it('reads a repeated key naming a live write as in flight', () => {
    // What a user pressing the button twice during a slow write receives.
    expect(
      isPendingWriteResponse(
        { taskmarket: { reason: 'idempotency_key_reused', intentStatus: 'broadcast' } },
        'x'
      )
    ).toBe(true);
  });

  it('reads a repeated key naming a failed write as a failure', () => {
    // The dangerous direction, now decided by a field rather than by which status word the
    // sentence happened to contain.
    expect(
      isPendingWriteResponse(
        { taskmarket: { reason: 'idempotency_key_reused', intentStatus: 'failed' } },
        'x'
      )
    ).toBe(false);
  });

  it('reads a classified failure as a failure even when its message sounds in flight', () => {
    // The envelope wins outright. A prose fallback that could override it would put the client
    // back to guessing on exactly the responses that are no longer a guess.
    expect(
      isPendingWriteResponse({ taskmarket: { reason: 'payment_rejected' } }, 'it remains in flight')
    ).toBe(false);
  });

  it('falls back to the message when the response carries no envelope', () => {
    // A browser session against a backend deployed before ADR-0058. Degraded, not broken.
    expect(isPendingWriteResponse({ error: 'x' }, 'the transaction remains in flight')).toBe(true);
    expect(isPendingWriteResponse({ error: 'x' }, 'Task is not open')).toBe(false);
  });
});

// These strings are copied from the backend, not paraphrased. They are the pre-ADR-0058
// fallback only -- kept for a backend that has not been redeployed yet, never extended.
describe('isPendingTransactionMessage', () => {
  it('matches the receipt-timeout error the dispatcher raises', () => {
    expect(
      isPendingTransactionMessage(
        'Server wallet transaction 0xabc (nonce 12) was broadcast but not confirmed within the request budget; it remains in flight'
      )
    ).toBe(true);
  });

  it('matches a repeated idempotency key whose intent has not settled', () => {
    expect(
      isPendingTransactionMessage(
        'tasks.create for this idempotency key is already recorded and is not submitted again (intent abc). Poll intents.get for its outcome.'
      )
    ).toBe(true);
    expect(
      isPendingTransactionMessage(
        'tasks.accept for this idempotency key is already broadcast and is not submitted again (intent abc). Poll intents.get for its outcome.'
      )
    ).toBe(true);
  });

  // The dangerous direction. A settled failure presented as "confirming" would leave a user
  // waiting on a write that is never coming, so `failed` must fall through as an ordinary error
  // even though the surrounding sentence is identical to the in-flight one.
  it('does not match a repeated key whose intent already failed', () => {
    expect(
      isPendingTransactionMessage(
        'tasks.create for this idempotency key is already failed and is not submitted again (intent abc). Poll intents.get for its outcome.'
      )
    ).toBe(false);
  });

  it('does not match ordinary contract and validation failures', () => {
    expect(isPendingTransactionMessage('Task is not open')).toBe(false);
    expect(isPendingTransactionMessage('execution reverted: TaskNotOpen')).toBe(false);
    expect(isPendingTransactionMessage('Insufficient USDC balance')).toBe(false);
  });
});

describe('pendingResultOf', () => {
  it('narrows an in-flight result and carries the key through', () => {
    expect(
      pendingResultOf({ ok: false, pending: true, idempotencyKey: 'key-1', error: 'in flight' })
    ).toEqual({
      ok: false,
      pending: true,
      idempotencyKey: 'key-1',
      error: 'in flight',
    });
  });

  it('returns null for success, for plain failure, and for a rejection', () => {
    expect(pendingResultOf({ ok: true, idempotencyKey: 'key-1' })).toBeNull();
    expect(pendingResultOf({ ok: false, error: 'Task is not open' })).toBeNull();
    expect(pendingResultOf({ ok: false, error: 'Cancelled in wallet' })).toBeNull();
  });

  // Without a key there is no handle to poll on or quote to support, so the in-flight surface
  // would render a reference it does not have. Falling through to the error path is correct.
  it('returns null when pending is claimed without an idempotency key', () => {
    expect(pendingResultOf({ ok: false, pending: true, error: 'in flight' })).toBeNull();
  });
});
