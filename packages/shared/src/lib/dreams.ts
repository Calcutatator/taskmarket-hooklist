const USDC_DECIMALS = 6n;
const DREAMS_DECIMALS = 18n;
const USDC_SCALE = 10n ** USDC_DECIMALS; // 1e6
const DREAMS_SCALE = 10n ** DREAMS_DECIMALS; // 1e18

/**
 * The USD value of the DREAMS bonus for a task reward, before conversion to tokens
 * or split between worker/requester. bonusBps is the tokenomics intensity knob (e.g.
 * 750 = 7.5% of task value) — independent of the DREAMS/USDC exchange rate. Returns
 * USDC base units (1e6).
 */
export function estimateUsdBonusValue(rewardBaseUnits: string, bonusBps: number): string {
  const reward = BigInt(rewardBaseUnits);
  if (reward <= 0n || bonusBps <= 0) return '0';
  return ((reward * BigInt(bonusBps)) / 10_000n).toString();
}

/** The worker's share (workerSplitBps) of the USD bonus value, in USDC base units. */
export function estimateWorkerUsdBonusValue(
  rewardBaseUnits: string,
  bonusBps: number,
  workerSplitBps: number
): string {
  const usdBonusValue = BigInt(estimateUsdBonusValue(rewardBaseUnits, bonusBps));
  if (usdBonusValue <= 0n) return '0';
  return ((usdBonusValue * BigInt(workerSplitBps)) / 10_000n).toString();
}

/** The requester's share of the USD bonus value (the complement of the worker's), in USDC base units. */
export function estimateRequesterUsdBonusValue(
  rewardBaseUnits: string,
  bonusBps: number,
  workerSplitBps: number
): string {
  const usdBonusValue = BigInt(estimateUsdBonusValue(rewardBaseUnits, bonusBps));
  if (usdBonusValue <= 0n) return '0';
  const workerUsd = (usdBonusValue * BigInt(workerSplitBps)) / 10_000n;
  return (usdBonusValue - workerUsd).toString();
}

/**
 * Estimate the worker's DREAMS bonus for a task reward, applying the USD bonus %
 * first, then converting to DREAMS at the given exchange rate, then splitting by
 * workerSplitBps — mirroring the on-chain order exactly. Display estimate only —
 * actual payouts also apply the wallet-age ramp and epoch budget caps, and
 * bounty-mode payouts settle at the rate/bonus % in effect at completion, not
 * necessarily the values used for this estimate.
 */
export function estimateWorkerDreamsBonus(
  rewardBaseUnits: string,
  dreamsPerUsdc: string,
  bonusBps: number,
  workerSplitBps: number
): string {
  const usdBonusValue = BigInt(estimateUsdBonusValue(rewardBaseUnits, bonusBps));
  const rate = BigInt(dreamsPerUsdc);
  if (usdBonusValue <= 0n || rate <= 0n) return '0';
  const total = (usdBonusValue * rate) / USDC_SCALE;
  const workerShare = (total * BigInt(workerSplitBps)) / 10_000n;
  return workerShare.toString();
}

/**
 * Estimate the requester's DREAMS bonus for a task reward — the complement of
 * estimateWorkerDreamsBonus. Same estimate caveats apply: pre-ramp, pre-cap, and
 * bounty-mode settles at completion-time rate/bonus %.
 */
export function estimateRequesterDreamsBonus(
  rewardBaseUnits: string,
  dreamsPerUsdc: string,
  bonusBps: number,
  workerSplitBps: number
): string {
  const usdBonusValue = BigInt(estimateUsdBonusValue(rewardBaseUnits, bonusBps));
  const rate = BigInt(dreamsPerUsdc);
  if (usdBonusValue <= 0n || rate <= 0n) return '0';
  const total = (usdBonusValue * rate) / USDC_SCALE;
  const workerShare = (total * BigInt(workerSplitBps)) / 10_000n;
  return (total - workerShare).toString();
}

/** Convert a DREAMS base-unit (1e18) amount to its USDC base-unit (1e6) equivalent at the given rate. */
export function dreamsToUsd(dreamsBaseUnits: string, dreamsPerUsdc: string): string {
  const dreams = BigInt(dreamsBaseUnits);
  const rate = BigInt(dreamsPerUsdc);
  if (dreams <= 0n || rate <= 0n) return '0';
  return ((dreams * USDC_SCALE) / rate).toString();
}

/** Format a DREAMS base-unit (1e18) amount as a full-precision decimal string, no truncation. */
export function formatDreams(baseUnits: string): string {
  const value = BigInt(baseUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / DREAMS_SCALE;
  const frac = abs % DREAMS_SCALE;
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fracStr.length > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}
