// Implements: ADR-0051
// Implements: ADR-0066
import type { GasFees } from './server-transaction-store';

/**
 * How far above the fee it replaces a clearing transfer is priced, as a percentage.
 *
 * Nodes enforce a minimum replacement bump -- around 10% on the mempools we relay through -- so
 * this is that minimum with room for rounding in bigint division and for a stricter provider,
 * matching the reasoning behind ADR-0051's `min(125)` on the escalation percentage. It is
 * deliberately *not* the configured escalation percentage: the clearing transfer is the one
 * transaction allowed above the cap, so it exceeds it by the smallest margin that still lands
 * rather than by however far the operator's curve happens to step.
 */
const CLEARING_BUMP_PCT = 125n;

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
   * True when the ceiling can no longer raise the fee -- clamping would price this attempt at
   * or below the one it replaces, which every node refuses as an insufficient bump.
   *
   * A separate field from `cappedBelowOpeningBid` rather than a widening of it, because the two
   * report different things about the ceiling. `cappedBelowOpeningBid` says the ceiling held an
   * ordinary attempt below the market; this says the ceiling has been reached and escalation
   * has nowhere left to go. An operator reading a single merged flag could not tell them apart.
   *
   * Both mean the same thing about the configuration -- `REPLACEMENT_GAS_MAX_MULTIPLE` (or
   * `REPLACEMENT_GAS_MAX_FEE_WEI`) is too low for the fee regime this deployment is in.
   */
  cappedBelowPreviousFee: boolean;
  /**
   * True when this attempt is the clearing self-transfer rather than a further escalation
   * (ADR-0066).
   *
   * Escalation stops at the cap. Rather than exceed the ceiling for ever -- which makes the cap
   * bound nothing -- or replace at the fee it is replacing -- which every node refuses -- the
   * reconciler sends one zero-value self-transfer priced just above the cap, which frees the
   * nonce and unblocks the queue. The caller is responsible for sending exactly one of these
   * per stuck nonce; this function only says that the moment has arrived.
   */
  clearing: boolean;
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

  // Escalation stops here (ADR-0066). A ceiling reached once is reached on every later pass --
  // the escalation is computed from `previous`, which is now the ceiling itself -- so clamping
  // returns exactly `previous`, and a replacement that does not raise the fee is rejected as
  // underpriced. Holding at the cap therefore holds nothing: it replaces forever while putting
  // nothing on the network. Exceeding the cap instead, which is what shipped before, makes the
  // cap bound nothing at all, which was its whole purpose.
  //
  // So neither: the curve halts, and this attempt becomes the single clearing self-transfer.
  // It is priced above the ceiling by the minimum bump and no more -- enough to be accepted,
  // and bounded, because there is exactly one of it per stuck nonce. A 21,000-gas transfer at
  // that price costs cents, while a blocked nonce blocks every paid write on the shared server
  // wallet (incident #54).
  //
  // This does not make the ceiling inert. It still binds every attempt up to and including the
  // pass that reaches it, where the clamped value is genuinely above `previous`.
  let cappedBelowPreviousFee = false;
  if (previous !== null && value <= previous) {
    cappedBelowPreviousFee = true;
    value = maxOf(ceilDiv(previous * CLEARING_BUMP_PCT, 100n), previous + 1n);
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
    // The same condition, named for what the caller must now do with it. Either field reaching
    // the end of its curve is enough: the transaction goes out at one price pair, and a nonce
    // that cannot be escalated on its max fee cannot be escalated at all.
    clearing: maxFee.cappedBelowPreviousFee || priorityFee.cappedBelowPreviousFee,
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
