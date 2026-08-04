import { describe, expect, it } from 'vitest';

import { isPendingTransactionMessage, pendingResultOf } from './relayed-write-outcome';

// These strings are copied from the backend, not paraphrased. The detection is a prose match
// (the backend rethrows ServerTransactionPendingError raw and the 409 carries its reason in a
// message), so a reworded backend breaks the client silently. These assertions are the alarm:
// if any of them stops matching the real text, this file is what has to change.
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
