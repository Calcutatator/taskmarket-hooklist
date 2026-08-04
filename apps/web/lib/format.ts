import { formatUsdcBaseUnits } from '@taskmarket/shared';

export function sumUsdcBaseUnits(values: Iterable<string>) {
  let total = 0n;
  for (const value of values) {
    try {
      total += BigInt(value);
    } catch {
      // Ignore malformed values so one bad record does not hide an aggregate.
    }
  }
  return total.toString();
}

export function formatUsdcUnits(value?: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return '0 USDC';
  }

  let baseUnits: bigint;
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '0 USDC';
      baseUnits = BigInt(Math.round(value));
    } else {
      const normalized = value.trim();
      if (!/^[+-]?\d+$/.test(normalized)) return '0 USDC';
      baseUnits = BigInt(normalized);
    }
  } catch {
    return '0 USDC';
  }

  return `${formatUsdcBaseUnits(baseUnits, { trimTrailingZeros: true, groupThousands: true })} USDC`;
}

export function usdcBaseUnitsToNumber(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 0;

  try {
    const baseUnits = typeof value === 'number' ? BigInt(Math.round(value)) : BigInt(value.trim());
    return Number(baseUnits) / 1_000_000;
  } catch {
    return 0;
  }
}

export function formatUsdcStatAmount(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0.00';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatUsdcStatUnits(value?: string | number | null) {
  return `${formatUsdcStatAmount(usdcBaseUnitsToNumber(value))} USDC`;
}

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined) {
    return '--';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return date.toLocaleString(undefined, { timeZoneName: 'short' });
}

// Basis points as a percentage, e.g. 250 -> "2.50%". Zero and absent both read as "None"
// because every caller so far uses bps for an optional cut that may simply not apply.
export function formatBps(value?: number | null) {
  if (!value) {
    return 'None';
  }

  return `${(value / 100).toFixed(2)}%`;
}

// The portion of a base-unit amount that a bps cut takes, for showing what a percentage
// actually costs alongside the percentage itself. Returns null when either input is
// unusable, so a caller renders nothing rather than a confident "0".
export function bpsShareOfBaseUnits(
  baseUnits?: string | number | null,
  bps?: number | null
): string | null {
  if (!bps || bps <= 0 || baseUnits === null || baseUnits === undefined || baseUnits === '') {
    return null;
  }

  try {
    const total = BigInt(typeof baseUnits === 'number' ? Math.trunc(baseUnits) : baseUnits);
    if (total <= 0n) {
      return null;
    }
    return ((total * BigInt(Math.round(bps))) / 10_000n).toString();
  } catch {
    return null;
  }
}

export type DeadlineUrgency = 'none' | 'expired' | 'soon' | 'normal';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Relative time-to-deadline for scannable urgency (e.g. "5h left", "2d left", "Expired").
// Pass nowMs so callers can drive it from a ticking clock; defaults to the current
// time. Keep formatDateTime for absolute timestamps in reference/detail contexts.
export function formatTimeLeft(
  value?: string | null,
  nowMs: number = Date.now()
): { label: string; urgency: DeadlineUrgency } {
  if (!value) {
    return { label: 'No deadline', urgency: 'none' };
  }

  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return { label: 'No deadline', urgency: 'none' };
  }

  const diff = ms - nowMs;
  if (diff <= 0) {
    return { label: 'Expired', urgency: 'expired' };
  }

  const minutes = Math.round(diff / 60_000);
  const hours = Math.round(diff / HOUR_MS);
  const days = Math.round(diff / DAY_MS);

  let label: string;
  if (minutes < 60) {
    label = `${Math.max(minutes, 1)}m left`;
  } else if (hours < 24) {
    label = `${hours}h left`;
  } else if (days < 30) {
    label = `${days}d left`;
  } else {
    label = `${Math.round(days / 30)}mo left`;
  }

  return { label, urgency: diff < DAY_MS ? 'soon' : 'normal' };
}

// Absolute length of a configured window, in the same m/h/d/mo vocabulary as
// formatTimeLeft. Distinct from formatTimeLeft because a window is a duration the
// requester chose ("24h"), not a countdown against the clock -- both appear side by
// side on the evaluation card and must not be confused for each other.
export function formatDurationSeconds(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return 'Not set';
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${Math.max(minutes, 1)}m`;
  }

  const hours = Math.round(seconds / 3600);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.round(seconds / 86_400);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

// Compact "time since" for activity timestamps: "just now", "2m ago", "3h ago",
// "5d ago", "2mo ago". Pass nowMs so callers can drive it from a ticking clock;
// defaults to the current time. Pair with formatDateTime for the absolute value.
export function formatRelativePast(value?: string | null, nowMs: number = Date.now()): string {
  if (!value) {
    return 'unknown';
  }

  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return 'unknown';
  }

  const diff = nowMs - ms;
  if (diff < 45_000) {
    return 'just now';
  }

  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(diff / HOUR_MS);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(diff / DAY_MS);
  if (days < 30) {
    return `${days}d ago`;
  }

  return `${Math.round(days / 30)}mo ago`;
}

export function compactAddress(value?: string | null) {
  if (!value) {
    return 'unknown';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
