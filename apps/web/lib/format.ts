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

export function compactAddress(value?: string | null) {
  if (!value) {
    return 'unknown';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
