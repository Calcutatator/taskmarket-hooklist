// Verifies: ADR-0051
import { describe, expect, it } from 'vitest';
import {
  computeReplacementFees,
  type ReplacementGasPolicy,
} from '../../../src/lib/replacement-gas';

/** The shipped defaults, chosen for Base. */
const POLICY: ReplacementGasPolicy = {
  escalationPct: 150n,
  firstBumpPct: 200n,
  maxFeeWei: null,
  maxMultiple: 10n,
};

const ORACLE = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };
const ORIGINAL = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };

function fees(maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) {
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** The ladder a flat oracle produces over `attempts` successive replacements. */
function ladder(attempts: number, policy = POLICY, oracle = ORACLE, original = ORIGINAL) {
  const rungs: bigint[] = [];
  let previous: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const decision = computeReplacementFees({ oracle, original, policy, previous });
    previous = decision.fees;
    rungs.push(decision.fees.maxFeePerGas);
  }
  return rungs;
}

describe('replacement gas escalation', () => {
  it('opens at the configured multiple of the live oracle', () => {
    const decision = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: POLICY,
      previous: null,
    });

    // 200% of the oracle, which is exactly the flat 2x that shipped before this decision.
    expect(decision.fees.maxFeePerGas).toBe(2_000_000n);
    expect(decision.capped).toBe(false);
  });

  it('still increases on every attempt when the oracle never moves', () => {
    // The bug: the old code multiplied the *oracle* rather than the fee being replaced, so on
    // a flat oracle the second replacement was priced identically to the first and providers
    // rejected it for an insufficient bump -- the reconciler then looped forever without ever
    // putting a new transaction on the network.
    const rungs = ladder(5);

    expect(rungs).toEqual([2_000_000n, 3_000_000n, 4_500_000n, 6_750_000n, 10_000_000n]);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!).toBeGreaterThan(rungs[i - 1]!);
      // And by more than any provider's minimum bump, not merely by one wei.
      expect(rungs[i]!).toBeGreaterThan((rungs[i - 1]! * 110n) / 100n);
    }
  });

  it('does not let bigint truncation round an escalation down to no increase', () => {
    // 1n * 150n / 100n truncates to 1n: an "escalation" to the identical price the network
    // already rejected. Ceiling division plus the previous + 1 floor rules it out outright.
    const decision = computeReplacementFees({
      oracle: fees(1n, 1n),
      original: fees(1n, 1n),
      policy: POLICY,
      previous: fees(1n, 1n),
    });

    expect(decision.fees.maxFeePerGas).toBeGreaterThan(1n);
    expect(decision.fees.maxPriorityFeePerGas).toBeGreaterThan(1n);
  });

  it('clamps at the multiple of the original fee on the pass that reaches it', () => {
    const ceiling = ORIGINAL.maxFeePerGas * POLICY.maxMultiple;
    const rungs = ladder(5);

    // 6_750_000 escalates to 10_125_000, which the ceiling pulls back to 10_000_000. That
    // clamp is real work and is still a genuine increase over the fee it replaces.
    expect(rungs.at(-1)).toBe(ceiling);
    expect(rungs.at(-1)!).toBeGreaterThan(rungs.at(-2)!);
  });

  it('keeps increasing past the ceiling rather than repeating the fee it replaces', () => {
    // The defect: with `previous` already at the ceiling, every later pass escalated above it,
    // clamped back, and landed on exactly `previous` -- which a provider rejects as an
    // insufficient bump. The reconciler then replaced forever while putting nothing on the
    // network, the same stuck-nonce loop ADR-0051 exists to end, reached through the ceiling
    // instead of through a flat oracle. Monotonicity wins over the cap.
    const rungs = ladder(8);

    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!, `rung ${i}`).toBeGreaterThan(rungs[i - 1]!);
      // And by more than any provider's minimum bump, not merely by one wei -- a strictly
      // greater fee that is still under the bump rule lands nothing either.
      expect(rungs[i]!, `rung ${i}`).toBeGreaterThan((rungs[i - 1]! * 110n) / 100n);
    }
    expect(rungs.at(-1)!).toBeGreaterThan(ORIGINAL.maxFeePerGas * POLICY.maxMultiple);
  });

  it('reports the breach so the operator can raise the ceiling', () => {
    // The cap being overridden is exactly the signal `cappedBelowOpeningBid` already aims at:
    // this deployment's REPLACEMENT_GAS_MAX_MULTIPLE is too low for its fee regime. Reported
    // as its own field because it says the opposite thing about the ceiling -- obeyed there,
    // disregarded here -- and an operator cannot tell those apart from one merged flag.
    const ceiling = ORIGINAL.maxFeePerGas * POLICY.maxMultiple;

    const held = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: POLICY,
      previous: fees(ceiling, ceiling / 10n),
    });

    expect(held.cappedBelowPreviousFee).toBe(true);
    expect(held.fees.maxFeePerGas).toBeGreaterThan(ceiling);

    // Not raised while the ceiling is doing its ordinary job.
    expect(ladder(3).length).toBe(3);
    const underCeiling = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: POLICY,
      previous: fees(2_000_000n, 200_000n),
    });
    expect(underCeiling.cappedBelowPreviousFee).toBe(false);
  });

  it('escapes an absolute wei ceiling the same way it escapes the multiple', () => {
    // The same hole, reached through REPLACEMENT_GAS_MAX_FEE_WEI: a `previous` already at the
    // absolute ceiling would otherwise be replaced by itself, forever.
    const decision = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: { ...POLICY, maxFeeWei: 1_500_000n },
      previous: fees(1_500_000n, 150_000n),
    });

    expect(decision.fees.maxFeePerGas).toBeGreaterThan(1_500_000n);
    expect(decision.cappedBelowPreviousFee).toBe(true);
  });

  it('keeps sending at the cap when the cap sits below the opening bid, and says so', () => {
    // The dangerous misconfiguration: every value looks fine in isolation, but the market has
    // moved so far since the original broadcast that the cap alone holds the attempt below
    // what the oracle says is sufficient. Refusing to send would be strictly worse -- the
    // nonce blocks every higher nonce on the shared wallet -- so it goes out at the cap.
    const decision = computeReplacementFees({
      oracle: fees(1_000_000_000n, 100_000_000n),
      original: fees(1_000n, 100n),
      policy: POLICY,
      previous: null,
    });

    expect(decision.fees.maxFeePerGas).toBe(10_000n);
    expect(decision.capped).toBe(true);
    expect(decision.cappedBelowOpeningBid).toBe(true);
  });

  it('applies the optional absolute ceiling after the multiple', () => {
    const decision = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: { ...POLICY, maxFeeWei: 1_500_000n },
      previous: null,
    });

    expect(decision.fees.maxFeePerGas).toBe(1_500_000n);
    expect(decision.capped).toBe(true);
  });

  it('takes the oracle immediately when the market outruns the curve', () => {
    // A chain-wide fee jump is matched in one pass rather than approached over several: the
    // oracle is a floor under the escalation, not the thing being escalated.
    const decision = computeReplacementFees({
      oracle: fees(9_000_000n, 900_000n),
      original: ORIGINAL,
      policy: POLICY,
      previous: fees(2_000_000n, 200_000n),
    });

    expect(decision.fees.maxFeePerGas).toBe(10_000_000n);
  });

  it('falls back to the opening bid when the row recorded no fee history', () => {
    // An abandoned reservation never broadcast anything, so there is no original to cap
    // against and no previous attempt to escalate from. That is the pre-ADR behaviour, which
    // is correct for a first attempt.
    const decision = computeReplacementFees({
      oracle: ORACLE,
      original: null,
      policy: POLICY,
      previous: null,
    });

    expect(decision.fees).toEqual(fees(2_000_000n, 200_000n));
    expect(decision.capped).toBe(false);
  });

  it('never lets the priority fee exceed the max fee', () => {
    // The clamps are applied per field, so a low max-fee cap and a high priority oracle can
    // otherwise produce a transaction the node rejects outright.
    const decision = computeReplacementFees({
      oracle: fees(1_000n, 1_000_000n),
      original: fees(1_000n, 1_000_000n),
      policy: { ...POLICY, maxFeeWei: 5_000n },
      previous: null,
    });

    expect(decision.fees.maxPriorityFeePerGas).toBeLessThanOrEqual(decision.fees.maxFeePerGas);
  });
});
