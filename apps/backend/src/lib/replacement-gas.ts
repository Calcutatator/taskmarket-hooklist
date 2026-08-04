// Implements: ADR-0051
import type { GasFees } from './server-transaction-store';

export type ReplacementGasPolicy = {
  /** Each attempt as a percentage of the previous attempt's fee. */
  escalationPct: bigint;
  /** Opening bid as a percentage of the live fee oracle. */
  firstBumpPct: bigint;
  /** Optional absolute per-gas ceiling, applied after the multiple. */
  maxFeeWei: bigint | null;
  /** Ceiling as a multiple of the original transaction's fee. */
  maxMultiple: bigint;
};

export type ReplacementGasDecision = {
  /** True when the ceiling bound the result at all. */
  capped: boolean;
  /**
   * True when the `original x maxMultiple` ceiling alone held the fee *below* the
   * oracle-derived opening bid -- i.e. this deployment's cap is too low for the fee regime it
   * is now operating in. Named separately because it is the one clamp an operator must act
   * on: the transaction still goes out (clearing the nonce never stops), but it goes out at a
   * price the market already says is insufficient.
   */
  cappedBelowOpeningBid: boolean;
  fees: GasFees;
};

/** Bigint division truncates, and a truncated escalation is no escalation at all. */
function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function maxOf(...values: bigint[]): bigint {
  return values.reduce((highest, value) => (value > highest ? value : highest));
}

function escalateField(
  oracle: bigint,
  previous: bigint | null,
  original: bigint | null,
  policy: ReplacementGasPolicy
): { capped: boolean; cappedBelowOpeningBid: boolean; value: bigint } {
  const openingBid = ceilDiv(oracle * policy.firstBumpPct, 100n);

  // The base of the multiplication is the price that already failed, not a fresh oracle
  // reading that may not have moved -- that choice, not the size of the percentage, is what
  // makes every attempt clear the provider's minimum bump. The `previous + 1n` term
  // guarantees strict monotonicity outright, so it does not depend on the configured
  // percentage surviving truncation at the bottom of the number range.
  let value =
    previous === null
      ? openingBid
      : maxOf(ceilDiv(previous * policy.escalationPct, 100n), openingBid, previous + 1n);

  // The multiple is applied *after* the +1 floor, so reaching the ceiling holds the fee there
  // rather than letting it creep one wei past the cap on every pass.
  const multipleCeiling = original === null ? null : original * policy.maxMultiple;
  let capped = false;
  let cappedBelowOpeningBid = false;
  if (multipleCeiling !== null && value > multipleCeiling) {
    capped = true;
    cappedBelowOpeningBid = multipleCeiling < openingBid;
    value = multipleCeiling;
  }
  if (policy.maxFeeWei !== null && value > policy.maxFeeWei) {
    capped = true;
    value = policy.maxFeeWei;
  }

  // A fee of zero is not a transaction. Only reachable from a zero original or a zero
  // absolute ceiling, both of which are misconfiguration rather than a real price.
  return { capped, cappedBelowOpeningBid, value: maxOf(value, 1n) };
}

/**
 * Price the next replacement attempt for a stuck nonce.
 *
 * Geometric escalation from the fee being replaced, floored by the live oracle, clamped by a
 * multiple of the original fee (ADR-0051). `previous` is null on the first replacement of a
 * nonce and `original` is null when the row never recorded what it was broadcast with -- an
 * abandoned reservation, or a row written before the fee columns existed. Both fall back to
 * the oracle-derived opening bid, which is exactly the behaviour that shipped before.
 */
export function computeReplacementFees(input: {
  oracle: GasFees;
  original: GasFees | null;
  policy: ReplacementGasPolicy;
  previous: GasFees | null;
}): ReplacementGasDecision {
  const { oracle, original, policy, previous } = input;

  const maxFee = escalateField(
    oracle.maxFeePerGas,
    previous?.maxFeePerGas ?? null,
    original?.maxFeePerGas ?? null,
    policy
  );
  const priorityFee = escalateField(
    oracle.maxPriorityFeePerGas,
    previous?.maxPriorityFeePerGas ?? null,
    original?.maxPriorityFeePerGas ?? null,
    policy
  );

  return {
    capped: maxFee.capped || priorityFee.capped,
    cappedBelowOpeningBid: maxFee.cappedBelowOpeningBid || priorityFee.cappedBelowOpeningBid,
    fees: {
      maxFeePerGas: maxFee.value,
      // A priority fee above the max fee is rejected outright, and the clamps above are
      // applied per field, so the two can drift apart at the cap.
      maxPriorityFeePerGas: maxOf(
        1n,
        priorityFee.value > maxFee.value ? maxFee.value : priorityFee.value
      ),
    },
  };
}
