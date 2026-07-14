export function formatRewardUsdc(reward: string): string {
  try {
    const base = BigInt(reward);
    const whole = base / 1_000_000n;
    const fraction = base % 1_000_000n;
    if (fraction === 0n) {
      return `$${whole.toString()}`;
    }
    const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '');
    return `$${whole.toString()}.${fractionText}`;
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
