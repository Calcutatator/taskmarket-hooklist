export function formatReward(value?: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return 'TBD';
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }

  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(parsed);
}

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

export function compactAddress(value?: string | null) {
  if (!value) {
    return 'unknown';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
