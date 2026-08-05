// Verifies: ADR-0051
// Verifies: ADR-0066
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

  it('stops escalating at the ceiling instead of climbing past it', () => {
    // ADR-0066: the escalation ladder is bounded by the cap. Every rung is strictly greater
    // than the one below it while the curve is still climbing, and the last rung the curve
    // itself produces is the ceiling -- never a value above it.
    //
    // Eight attempts, not five: the ceiling binds on the fifth, so a shorter run never reaches
    // the attempts that used to climb past it. Escalation is followed only up to the point it
    // asks to stop, which is what the reconciler does with the same signal.
    const ceiling = ORIGINAL.maxFeePerGas * POLICY.maxMultiple;
    const rungs: bigint[] = [];
    let previous: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const decision = computeReplacementFees({
        oracle: ORACLE,
        original: ORIGINAL,
        policy: POLICY,
        previous,
      });
      if (decision.clearing) break;
      previous = decision.fees;
      rungs.push(decision.fees.maxFeePerGas);
    }

    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!, `rung ${i}`).toBeGreaterThan(rungs[i - 1]!);
      // And by more than any provider's minimum bump, not merely by one wei -- a strictly
      // greater fee that is still under the bump rule lands nothing either.
      expect(rungs[i]!, `rung ${i}`).toBeGreaterThan((rungs[i - 1]! * 110n) / 100n);
      expect(rungs[i]!, `rung ${i}`).toBeLessThanOrEqual(ceiling);
    }
    expect(rungs.at(-1)!).toBe(ceiling);
    // The curve genuinely halted rather than merely running out of attempts.
    expect(rungs.length).toBeLessThan(8);
  });

  it('asks for a clearing transfer once the ceiling can no longer raise the fee', () => {
    // ADR-0066: at the ceiling the clamp would price the replacement at exactly the fee it
    // replaces, which every node refuses as an insufficient bump. Escalation therefore stops,
    // and the nonce is cleared instead by one zero-value self-transfer priced above the cap by
    // the provider's minimum bump. `cappedBelowPreviousFee` keeps its meaning -- the ceiling
    // can no longer raise the fee -- and changes its consumer from "exceed" to "stop and clear".
    const ceiling = ORIGINAL.maxFeePerGas * POLICY.maxMultiple;

    const held = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: POLICY,
      previous: fees(ceiling, ceiling / 10n),
    });

    expect(held.cappedBelowPreviousFee).toBe(true);
    expect(held.clearing).toBe(true);
    // Above the cap, but only by the margin the minimum bump requires -- not by the full
    // escalation, which would be an unbounded climb wearing a different name.
    expect(held.fees.maxFeePerGas).toBeGreaterThanOrEqual((ceiling * 110n) / 100n);
    expect(held.fees.maxFeePerGas).toBeLessThan((ceiling * POLICY.escalationPct) / 100n);

    // Not raised while the ceiling is doing its ordinary job.
    const underCeiling = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: POLICY,
      previous: fees(2_000_000n, 200_000n),
    });
    expect(underCeiling.cappedBelowPreviousFee).toBe(false);
    expect(underCeiling.clearing).toBe(false);
  });

  it('clears an absolute wei ceiling the same way it clears the multiple', () => {
    // The same edge, reached through REPLACEMENT_GAS_MAX_FEE_WEI: a `previous` already at the
    // absolute ceiling would otherwise be replaced by itself, forever.
    const decision = computeReplacementFees({
      oracle: ORACLE,
      original: ORIGINAL,
      policy: { ...POLICY, maxFeeWei: 1_500_000n },
      previous: fees(1_500_000n, 150_000n),
    });

    expect(decision.fees.maxFeePerGas).toBeGreaterThanOrEqual((1_500_000n * 110n) / 100n);
    expect(decision.clearing).toBe(true);
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

  it('never lets that clamp price the priority fee at or below its predecessor', () => {
    // The clamp above is applied after each field's own monotonicity guarantee, so on its face
    // it could hand back a priority fee no higher than the one it replaces -- which every node
    // refuses as an insufficient bump, the exact failure escalation exists to avoid.
    //
    // It cannot, and the reason is an invariant rather than an accident of the numbers: every
    // step of `escalateField` is monotone in its inputs, so an input triple whose priority fee
    // never exceeds its max fee produces an output with the same property, and a clamp that
    // never binds cannot lower anything. Real inputs always have that property -- a broadcast
    // records the fees this function returned, or viem's own estimate, and neither puts the
    // priority fee above the max fee.
    //
    // Swept rather than argued, over the shapes that actually bind: the multiple ceiling, the
    // absolute ceiling, and the clearing pass past both.
    const scale = 100_000n;
    for (const oracleMax of [1n, 5n, 12n]) {
      for (const oraclePriority of [1n, 3n, 5n]) {
        if (oraclePriority > oracleMax) continue;
        for (const previousMax of [1n, 4n, 10n]) {
          for (const previousPriority of [1n, 2n, 10n]) {
            if (previousPriority > previousMax) continue;
            for (const maxMultiple of [1n, 2n, 10n]) {
              for (const maxFeeWei of [null, 2n, 8n]) {
                const decision = computeReplacementFees({
                  oracle: fees(oracleMax * scale, oraclePriority * scale),
                  original: fees(previousMax * scale, previousPriority * scale),
                  policy: {
                    ...POLICY,
                    maxFeeWei: maxFeeWei === null ? null : maxFeeWei * scale,
                    maxMultiple,
                  },
                  previous: fees(previousMax * scale, previousPriority * scale),
                });

                expect(
                  decision.fees.maxPriorityFeePerGas,
                  `priority ${previousPriority}/${previousMax} under cap ${String(maxFeeWei)}x${maxMultiple}`
                ).toBeGreaterThan(previousPriority * scale);
                expect(decision.fees.maxPriorityFeePerGas).toBeLessThanOrEqual(
                  decision.fees.maxFeePerGas
                );
              }
            }
          }
        }
      }
    }
  });
});
