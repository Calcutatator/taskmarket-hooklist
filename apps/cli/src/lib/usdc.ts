const USDC_DECIMALS = 6;

export function usdcToBaseUnits(value: string, options: { allowZero?: boolean } = {}): string {
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(normalized);
  if (!match) {
    throw new Error('USDC amount must be a positive decimal with at most 6 fractional digits');
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0') || '0');
  const baseUnits = whole * 1_000_000n + fraction;
  if (baseUnits < 0n || (baseUnits === 0n && !options.allowZero)) {
    throw new Error('USDC amount must be greater than zero');
  }
  return baseUnits.toString();
}
