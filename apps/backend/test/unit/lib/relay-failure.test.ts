// Verifies: ADR-0047
import { describe, expect, it } from 'vitest';
import { classifyRelayFailure, relayFailureReason } from '../../../src/lib/relay-failure';

describe('relay failure classification', () => {
  it('treats a decoded contract revert as deterministic', () => {
    // The exact shape services/contract.ts produces for a rejected relayed call.
    const error = new Error('Contract call rejected: TaskNotOpen');
    expect(classifyRelayFailure(error)).toBe('deterministic');
    expect(relayFailureReason(error)).toBe('TaskNotOpen');
  });

  it('treats an undecodable revert as transient, since the retry loop exhausts into it', () => {
    expect(classifyRelayFailure(new Error('Contract call rejected: unknown revert'))).toBe(
      'transient'
    );
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
