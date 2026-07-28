// Shared chart axis label formatting. Every chart in the kit renders a day
// bucket the same way through this module so the trend axis and the heat map
// directly below it never disagree on a date. The locale is pinned to 'en-US'
// rather than the ambient one: an ambient locale renders differently on the Node
// server than in the browser, which is a hydration mismatch waiting to happen.

const DAY_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Matches a leading ISO-ish calendar date, so both '2026-06-21' and a full
// timestamp like '2026-06-21T12:00:00Z' are recognized.
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// A 'YYYY-MM-DD' UTC bucket rendered as a short "Jun 4" style tick. Parsing the
// date parts directly avoids a local-timezone shift on the day boundary. Values
// that are not a calendar date are returned untouched so a caller can pass any
// bucket key through.
export function formatBucketTick(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// Best-effort axis key formatter for the heat map, which mixes key shapes across
// its two dimensions. Recognizes three shapes and otherwise returns the key
// untouched:
//   - ISO-ish dates (2026-06-21)            -> "Jun 21"
//   - day-of-week index (0-6)               -> "Sun".."Sat"
//   - hour of day (0-23)                    -> "0".."23" (left as-is)
export function formatAxisKey(key: string): string {
  const trimmed = key.trim();

  if (ISO_DATE_PREFIX.test(trimmed)) {
    return formatBucketTick(trimmed);
  }

  // Day-of-week index.
  if (/^[0-6]$/.test(trimmed)) {
    return DAY_OF_WEEK[Number(trimmed)];
  }

  return key;
}
