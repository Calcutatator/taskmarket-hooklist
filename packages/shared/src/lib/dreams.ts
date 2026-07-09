const USDC_DECIMALS = 6n;
const DREAMS_DECIMALS = 18n;
const USDC_SCALE = 10n ** USDC_DECIMALS; // 1e6
const DREAMS_SCALE = 10n ** DREAMS_DECIMALS; // 1e18

/**
 * Estimate the worker's DREAMS bonus for a task reward at the given dreamsPerUsdc
 * rate and worker split. Display estimate only — actual payouts also apply the
 * wallet-age ramp and epoch budget caps, and bounty-mode payouts settle at the
 * rate in effect at completion, not necessarily the rate used for this estimate.
 */
export function estimateDreamsBonus(
  rewardBaseUnits: string,
  dreamsPerUsdc: string,
  workerSplitBps: number
): string {
  const reward = BigInt(rewardBaseUnits);
  const rate = BigInt(dreamsPerUsdc);
  if (reward <= 0n || rate <= 0n) return '0';
  const total = (reward * rate) / USDC_SCALE;
  const workerShare = (total * BigInt(workerSplitBps)) / 10_000n;
  return workerShare.toString();
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
