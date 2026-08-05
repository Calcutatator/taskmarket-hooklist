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
  /**
   * True when a ceiling was *overridden* to keep the fee above the one it replaces.
   *
   * A separate field from `cappedBelowOpeningBid` rather than a widening of it, because the two
   * report opposite things about the ceiling. `cappedBelowOpeningBid` says the ceiling was
   * obeyed and the transaction went out underpriced; this says the ceiling was disregarded and
   * the transaction went out above it. An operator reading a single merged flag could not tell
   * whether their configured maximum was honoured, which is the one fact they set it to control.
   *
   * Both mean the same thing about the configuration -- `REPLACEMENT_GAS_MAX_MULTIPLE` (or
   * `REPLACEMENT_GAS_MAX_FEE_WEI`) is too low for the fee regime this deployment is in -- and
   * this one means it has already begun costing more than it saves.
   */
  cappedBelowPreviousFee: boolean;
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
): {
  capped: boolean;
  cappedBelowOpeningBid: boolean;
  cappedBelowPreviousFee: boolean;
  value: bigint;
} {
  const openingBid = ceilDiv(oracle * policy.firstBumpPct, 100n);

  // The base of the multiplication is the price that already failed, not a fresh oracle
  // reading that may not have moved -- that choice, not the size of the percentage, is what
  // makes every attempt clear the provider's minimum bump. The `previous + 1n` term
  // guarantees strict monotonicity outright, so it does not depend on the configured
  // percentage surviving truncation at the bottom of the number range.
  const escalated =
    previous === null
      ? openingBid
      : maxOf(ceilDiv(previous * policy.escalationPct, 100n), openingBid, previous + 1n);
  let value = escalated;

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

  // Monotonicity wins over the ceiling, always. A ceiling reached once is reached on every
  // later pass -- the escalation is computed from `previous`, which is now the ceiling itself
  // -- so clamping would return exactly `previous`, and a replacement that does not raise the
  // fee is rejected as underpriced. Holding at the cap therefore does not "hold" anything: it
  // replaces forever while putting nothing on the network, which is the stuck-nonce loop
  // ADR-0051 exists to end, reached through the ceiling instead of through a flat oracle.
  //
  // The cost asymmetry settles which side gives. Exceeding the cap costs cents: a replacement
  // is a 21,000-gas self-transfer, and the cap bounds a per-gas price, not an exposure. A
  // blocked nonce blocks every paid write on the shared server wallet (incident #54). So the
  // fee is restored to the full escalation -- not to `previous + 1`, which is strictly greater
  // arithmetically but still under every provider's minimum-bump rule and so still lands
  // nothing.
  //
  // This does not make the ceiling inert. It still binds on the first attempt and on the first
  // pass that reaches it, where the clamped value is genuinely above `previous`; only the
  // passes after that override it, and each one says so.
  let cappedBelowPreviousFee = false;
  if (previous !== null && value <= previous) {
    cappedBelowPreviousFee = true;
    value = escalated;
  }

  // A fee of zero is not a transaction. Only reachable from a zero original or a zero
  // absolute ceiling, both of which are misconfiguration rather than a real price.
  return { capped, cappedBelowOpeningBid, cappedBelowPreviousFee, value: maxOf(value, 1n) };
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
    cappedBelowPreviousFee: maxFee.cappedBelowPreviousFee || priorityFee.cappedBelowPreviousFee,
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
