export function formatUsdcUnits(value?: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return '0.000 USDC';
  }

  const parsed = Number(value) / 1_000_000;
  if (!Number.isFinite(parsed)) {
    return '0.000 USDC';
  }

  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  }).format(parsed)} USDC`;
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

export type DeadlineUrgency = 'none' | 'expired' | 'soon' | 'normal';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Relative time-to-deadline for scannable urgency (e.g. "5h left", "2d left", "Expired").
// Keep formatDateTime for absolute timestamps in reference/detail contexts.
export function formatTimeLeft(value?: string | null): { label: string; urgency: DeadlineUrgency } {
  if (!value) {
    return { label: 'No deadline', urgency: 'none' };
  }

  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return { label: 'No deadline', urgency: 'none' };
  }

  const diff = ms - Date.now();
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

export function compactAddress(value?: string | null) {
  if (!value) {
    return 'unknown';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
