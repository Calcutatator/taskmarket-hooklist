import { USDC_DECIMALS } from '@taskmarket/shared';

const USDC_BASE_UNITS = 10n ** BigInt(USDC_DECIMALS);
const USDC_PATTERN = new RegExp(`^(0|[1-9][0-9]*)(?:\\.([0-9]{1,${USDC_DECIMALS}}))?$`);

export function usdcToBaseUnits(value: string, options: { allowZero?: boolean } = {}): string {
  const normalized = value.trim();
  const match = USDC_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(
      `USDC amount must be a positive decimal with at most ${USDC_DECIMALS} fractional digits`
    );
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0') || '0');
  const baseUnits = whole * USDC_BASE_UNITS + fraction;
  if (baseUnits < 0n || (baseUnits === 0n && !options.allowZero)) {
    throw new Error('USDC amount must be greater than zero');
  }
  return baseUnits.toString();
}
