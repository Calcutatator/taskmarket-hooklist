// Verifies: ADR-0049
// Verifies: ADR-0058
// Verifies: ADR-0070
import { describe, expect, it } from 'vitest';
import { API_ERROR_REASONS, apiErrorEnvelopeOf, isInFlightApiError } from '@taskmarket/shared';

import {
  apiError,
  apiErrorBody,
  codeForReason,
  envelopeForError,
  intentStatusOf,
} from '../../../src/lib/api-error';

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

  it('refuses a reused-key envelope that does not say what the intent is doing', () => {
    // The reason asserts an intent under this key exists, so it has a status, and every reader
    // of this envelope needs it: without one, "is this still landing" has no answer but a
    // guess. Unparseable rather than defaulted (ADR-0070).
    expect(apiErrorEnvelopeOf({ reason: 'idempotency_key_reused', intentId: 'i-1' })).toBeNull();
    expect(
      apiErrorEnvelopeOf({
        reason: 'idempotency_key_reused',
        intentId: 'i-1',
        intentStatus: 'recorded',
      })?.intentStatus
    ).toBe('recorded');
  });

  it('keeps intentStatus optional for every reason that may not name an intent', () => {
    expect(apiErrorEnvelopeOf({ reason: 'payment_rejected' })?.reason).toBe('payment_rejected');
    expect(apiErrorEnvelopeOf({ reason: 'intent_in_flight' })?.reason).toBe('intent_in_flight');
    expect(apiErrorEnvelopeOf({ reason: 'idempotency_check_unavailable' })?.reason).toBe(
      'idempotency_check_unavailable'
    );
  });

  it('still reads an unrecognised shape as no information at all', () => {
    // The guarantee a client on an older shared package depends on: what it cannot parse it
    // must treat as nothing, never as something to compare against.
    expect(apiErrorEnvelopeOf({ reason: 'not_a_reason' })).toBeNull();
    expect(
      apiErrorEnvelopeOf({ reason: 'idempotency_key_reused', intentStatus: 'in_progress' })
    ).toBeNull();
  });

  it('parses a relayed intent status rather than asserting it', () => {
    // The column is `text`; a cast to the five would let a drifted value travel unchallenged.
    expect(intentStatusOf('broadcast')).toBe('broadcast');
    expect(() => intentStatusOf('in_progress')).toThrow();
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
    expect(isInFlightApiError({ reason: 'idempotency_key_reused', intentStatus: 'recorded' })).toBe(
      true
    );
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
    const nonTerminal = new Set(['intent_in_flight', 'intent_completion_deferred']);
    for (const reason of API_ERROR_REASONS) {
      // `idempotency_key_reused` is skipped by its literal rather than through the set so the
      // compiler narrows it away: it is the one reason that cannot form an envelope without an
      // `intentStatus`, and the two tests above cover both of its answers.
      if (reason === 'idempotency_key_reused' || nonTerminal.has(reason)) continue;
      expect(isInFlightApiError({ reason }), reason).toBe(false);
    }
  });

  it('reads a completion-deferred result as in flight', () => {
    // The chain call is confirmed, so the work happened and only the recording of it is
    // outstanding. Reporting this as settled told a script following the documented
    // `pending: false` rule -- "the write did not happen, retrying is an ordinary decision" --
    // to re-run a paid action that had already succeeded. The caller pays twice.
    expect(isInFlightApiError({ reason: 'intent_completion_deferred' })).toBe(true);
  });

  it('keeps a settled payment out of the in-flight set when the write itself did not happen', () => {
    // The set answers "is something still landing", not "was anything charged". Each of these
    // named a payment that settled, and in each the write the caller described provably did not
    // happen -- what is outstanding is a refund, which `reason` reports. Marking them in flight
    // would tell a caller to poll an intent that will never move on their behalf.
    expect(isInFlightApiError({ reason: 'payment_already_spent' })).toBe(false);
    expect(isInFlightApiError({ reason: 'payment_payer_mismatch' })).toBe(false);
    expect(isInFlightApiError({ reason: 'idempotency_key_payload_mismatch' })).toBe(false);
  });

  it('treats an unrecognised reason as no information at all', () => {
    // A client built against an older shared package must not compare a value it cannot
    // interpret; it must see nothing.
    expect(apiErrorEnvelopeOf({ taskmarket: { reason: 'something_new' } })).toBeNull();
    expect(
      isInFlightApiError(apiErrorEnvelopeOf({ taskmarket: { reason: 'something_new' } }))
    ).toBe(false);
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
