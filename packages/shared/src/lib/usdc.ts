import { USDC_DECIMALS } from '../platform.constants';

const USDC_BASE_UNITS = 10n ** BigInt(USDC_DECIMALS);
const USDC_PATTERN = new RegExp(`^(0|[1-9][0-9]*)(?:\\.([0-9]{1,${USDC_DECIMALS}}))?$`);

/**
 * Parse a human-readable USDC amount (e.g. "5", "5.25") into its base-unit
 * string (1e6). Rejects anything that is not a non-negative decimal with at
 * most USDC_DECIMALS fractional digits. Zero is rejected unless allowZero is set.
 */
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

export type FormatUsdcOptions = {
  /** Drop trailing zeros in the fractional part (e.g. "12.500000" -> "12.5", "12.000000" -> "12"). */
  trimTrailingZeros?: boolean;
  /** Group the whole part with locale thousands separators (e.g. "1,500"). */
  groupThousands?: boolean;
};

/**
 * Format a USDC base-unit (1e6) amount as a plain decimal string, with no currency
 * prefix or suffix. Uses exact bigint math so values above the JavaScript
 * safe-integer limit are preserved. Throws if value cannot be coerced to a bigint.
 *
 * Defaults produce a fixed six-decimal string ("12.000000"); callers that want a
 * trimmed and/or grouped display opt in via options and add their own "$"/" USDC".
 */
export function formatUsdcBaseUnits(
  value: string | bigint,
  options: FormatUsdcOptions = {}
): string {
  const baseUnits = BigInt(value);
  const negative = baseUnits < 0n;
  const absolute = negative ? -baseUnits : baseUnits;

  const wholeUnits = absolute / USDC_BASE_UNITS;
  const fractionalUnits = absolute % USDC_BASE_UNITS;

  const whole = options.groupThousands
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(wholeUnits)
    : wholeUnits.toString();

  let fraction = fractionalUnits.toString().padStart(USDC_DECIMALS, '0');
  if (options.trimTrailingZeros) {
    fraction = fraction.replace(/0+$/, '');
  }

  const sign = negative ? '-' : '';
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
