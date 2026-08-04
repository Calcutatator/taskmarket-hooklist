// Verifies: ADR-0049
// Verifies: ADR-0058
import { describe, expect, it } from 'vitest';
import { API_ERROR_REASONS, apiErrorEnvelopeOf, isInFlightApiError } from '@taskmarket/shared';

import { apiError, apiErrorBody, codeForReason, envelopeForError } from '../../../src/lib/api-error';

describe('the API error envelope', () => {
  it('gives an in-flight write a 409 rather than a 500', () => {
    // The status matters on its own, before any client reads the envelope. 5xx is what a
    // generic retrying HTTP client retries, and a retried paid write is a second payment. 409
    // stops it without the client knowing anything about Taskmarket (ADR-0058 decision 3).
    expect(codeForReason('intent_in_flight')).toBe('CONFLICT');
    expect(codeForReason('idempotency_key_reused')).toBe('CONFLICT');
  });

  it('carries the intent id and status a caller has to key on', () => {
    const error = apiError({
      reason: 'intent_in_flight',
      intentId: 'intent-1',
      intentStatus: 'broadcast',
      operation: 'tasks.create',
      idempotencyKey: 'key-1',
      txHash: '0xabc',
      message: 'still landing',
    });

    expect(error.envelope).toEqual({
      reason: 'intent_in_flight',
      intentId: 'intent-1',
      intentStatus: 'broadcast',
      operation: 'tasks.create',
      idempotencyKey: 'key-1',
      txHash: '0xabc',
    });
    // The message survives -- it is still the human-readable half. It is only no longer the
    // only half.
    expect(error.message).toBe('still landing');
  });

  it('omits fields a reason does not have rather than nulling them', () => {
    // A caller tests presence, not presence-and-non-null. A pre-broadcast rejection genuinely
    // has no transaction hash, because none was ever created.
    const error = apiError({ reason: 'idempotency_key_required', message: 'no key' });

    expect(error.envelope).toEqual({ reason: 'idempotency_key_required' });
    expect('txHash' in error.envelope).toBe(false);
  });

  it('classifies an error nobody classified rather than leaving the field absent', () => {
    // "Every error carries a discriminator" is only worth something with no exceptions: a
    // client that must test for the field before branching is back to reading the message
    // whenever it is missing.
    expect(envelopeForError(new Error('something'))).toEqual({ reason: 'unclassified' });
    expect(envelopeForError(undefined)).toEqual({ reason: 'unclassified' });
  });

  it('finds the envelope through a wrapper that hung the original off cause', () => {
    const inner = apiError({ reason: 'intent_in_flight', intentId: 'i-1', message: 'x' });
    const wrapper = new Error('wrapped', { cause: inner });

    expect(envelopeForError(wrapper).reason).toBe('intent_in_flight');
    expect(envelopeForError(wrapper).intentId).toBe('i-1');
  });

  it('publishes the same envelope on an Express body as on a tRPC error', () => {
    // The x402 middleware answers `res` itself, before any procedure runs, so its refusals
    // never reach the errorFormatter. One vocabulary regardless, or a paid write refused at
    // two layers speaks two languages.
    const body = apiErrorBody({ reason: 'payment_rejected', message: 'settlement failed' });

    expect(body).toEqual({
      error: 'settlement failed',
      taskmarket: { reason: 'payment_rejected' },
    });
    expect(apiErrorEnvelopeOf(body)?.reason).toBe('payment_rejected');
  });

  it('maps every declared reason to a status', () => {
    for (const reason of API_ERROR_REASONS) {
      expect(codeForReason(reason), `no status for ${reason}`).toBeTruthy();
    }
  });
});

describe('what a client branches on', () => {
  it('reads an in-flight write as in flight', () => {
    expect(isInFlightApiError({ reason: 'intent_in_flight' })).toBe(true);
  });

  it('reads a repeated key naming a live write as in flight', () => {
    // This is what a user pressing the button twice during a slow write receives. If it read
    // as a failure, the surface built to stop a second payment would present an error at the
    // exact moment they are deciding whether to pay again.
    expect(
      isInFlightApiError({ reason: 'idempotency_key_reused', intentStatus: 'broadcast' })
    ).toBe(true);
    expect(
      isInFlightApiError({ reason: 'idempotency_key_reused', intentStatus: 'recorded' })
    ).toBe(true);
  });

  it('reads a repeated key naming a settled write as not in flight', () => {
    // The false positive that matters in the other direction: showing a settled failure as
    // "still confirming" leaves someone waiting for a write that is already dead.
    expect(isInFlightApiError({ reason: 'idempotency_key_reused', intentStatus: 'failed' })).toBe(
      false
    );
    expect(
      isInFlightApiError({ reason: 'idempotency_key_reused', intentStatus: 'completed' })
    ).toBe(false);
  });

  it('reads every terminal reason as not in flight', () => {
    for (const reason of API_ERROR_REASONS) {
      if (reason === 'intent_in_flight' || reason === 'idempotency_key_reused') continue;
      expect(isInFlightApiError({ reason }), reason).toBe(false);
    }
  });

  it('reads a completion-deferred result as not in flight', () => {
    // The chain call landed and the work happened. Nothing is waiting on the chain, so a
    // client that polls here would poll an intent that is never going to move for its sake.
    expect(isInFlightApiError({ reason: 'intent_completion_deferred' })).toBe(false);
  });

  it('treats an unrecognised reason as no information at all', () => {
    // A client built against an older shared package must not compare a value it cannot
    // interpret; it must see nothing.
    expect(apiErrorEnvelopeOf({ taskmarket: { reason: 'something_new' } })).toBeNull();
    expect(isInFlightApiError(apiErrorEnvelopeOf({ taskmarket: { reason: 'something_new' } }))).toBe(
      false
    );
  });

  it('finds the envelope in each shape a transport delivers it in', () => {
    const envelope = { reason: 'intent_in_flight' as const, intentId: 'i-1' };

    expect(apiErrorEnvelopeOf(envelope)?.intentId).toBe('i-1');
    // Raw REST and the x402 middleware body.
    expect(apiErrorEnvelopeOf({ error: 'x', taskmarket: envelope })?.intentId).toBe('i-1');
    // A tRPC client error exposes it on `.data`.
    expect(apiErrorEnvelopeOf({ data: { taskmarket: envelope } })?.intentId).toBe('i-1');
    // A tRPC HTTP response nests it under `error.data`.
    expect(apiErrorEnvelopeOf({ error: { data: { taskmarket: envelope } } })?.intentId).toBe('i-1');
    expect(apiErrorEnvelopeOf({ error: 'no envelope here' })).toBeNull();
  });
});
