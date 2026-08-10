// Verifies: ADR-0047, ADR-0074
import { describe, expect, it } from 'vitest';
import {
  classifyRelayFailure,
  relayFailureReason,
  UndeterminedRelayError,
} from '../../../src/lib/relay-failure';

describe('relay failure classification', () => {
  it('treats a decoded contract revert as deterministic', () => {
    // The exact shape services/contract.ts produces for a rejected relayed call.
    const error = new Error('Contract call rejected: TaskNotOpen');
    expect(classifyRelayFailure(error)).toBe('deterministic');
    expect(relayFailureReason(error)).toBe('TaskNotOpen');
  });

  it('treats an undecodable relay failure as transient, stated rather than spelled', () => {
    // `unknown revert` used to carry this verdict, inside a message that simultaneously told a
    // caller the contract had rejected them. One string, two meanings, and wrong for both
    // audiences. The verdict now lives in a type and the prose is free to be true.
    const error = new UndeterminedRelayError('Contract call did not reach a decodable outcome');
    expect(classifyRelayFailure(error)).toBe('transient');
    expect(error.message).not.toContain('Contract call rejected');
  });

  it('does not read the revert prefix out of an undetermined failure', () => {
    // The class wins over any text, so a detail string that happens to quote a revert message
    // cannot talk an established non-verdict into a terminal one.
    const error = new UndeterminedRelayError('last attempt: Contract call rejected: TaskNotOpen');
    expect(classifyRelayFailure(error)).toBe('transient');
  });

  it.each([
    'Timed out while waiting for transaction receipt',
    'connect ECONNRESET 10.0.0.1:8545',
    'HTTP request failed: too many requests',
    'fetch failed',
  ])('treats a transport failure as transient: %s', (message) => {
    expect(classifyRelayFailure(new Error(message))).toBe('transient');
  });

  it.each(['DeadlineExceeded', 'EvaluatorTimedOut', 'SubmissionRateLimited'])(
    'reads a decoded revert as the contract meant it, marker substring or not: %s',
    (reason) => {
      // The contract's error vocabulary is not chosen to avoid our transport words, so scanning
      // the whole message for markers before parsing the revert prefix reads the chain's own
      // verdict as a network hiccup -- and retries a call that can only ever revert again.
      const error = new Error(`Contract call rejected: ${reason}`);
      expect(classifyRelayFailure(error)).toBe('deterministic');
      expect(relayFailureReason(error)).toBe(reason);
    }
  );

  it('defaults to transient for an unrecognised error', () => {
    // Never invent a terminal verdict: stranding work that a retry would have finished is the
    // more expensive of the two mistakes.
    expect(classifyRelayFailure(new Error('something nobody has seen before'))).toBe('transient');
  });
});
