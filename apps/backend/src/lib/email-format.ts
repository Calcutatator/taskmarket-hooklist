import { formatUsdcBaseUnits } from '@taskmarket/shared';

export function formatRewardUsdc(reward: string): string {
  try {
    return `$${formatUsdcBaseUnits(reward, { trimTrailingZeros: true })}`;
  } catch {
    return reward;
  }
}

export function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}
