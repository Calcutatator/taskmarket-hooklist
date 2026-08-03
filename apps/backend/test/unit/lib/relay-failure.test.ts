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

  it('defaults to transient for an unrecognised error', () => {
    // Never invent a terminal verdict: stranding work that a retry would have finished is the
    // more expensive of the two mistakes.
    expect(classifyRelayFailure(new Error('something nobody has seen before'))).toBe('transient');
  });
});
