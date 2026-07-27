'use client';

import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { useReducedTick } from '@/components/market/motion/use-reduced-tick';

// A drop's closing time, to the second.
//
// CountdownTimer is the right component nearly everywhere, but it renders formatTimeLeft's coarse
// label ('22h left') in muted-foreground / warning / destructive tokens. On the drop hero the
// closing time IS the headline, so it needs hh:mm:ss and the hero's own cream, and hard-coding a
// token override on a page-scoped green field would fight the semantic palette.
//
// The clock itself is reused rather than rebuilt: useReducedTick is the single place clock
// hydration safety lives. It returns null on the server and the first client paint, so the static
// label below renders identically on both sides of hydration, then starts ticking. Under reduced
// motion the absolute deadline is shown instead, so the page stays accurate without moving digits.

const HOUR_MS = 3_600_000;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function formatClock(source: string | null | undefined, nowMs: number) {
  if (!source) {
    return null;
  }
  const target = new Date(source).getTime();
  if (!Number.isFinite(target)) {
    return null;
  }
  const diff = target - nowMs;
  if (diff <= 0) {
    return '00:00:00';
  }
  const hours = Math.floor(diff / HOUR_MS);
  const minutes = Math.floor((diff % HOUR_MS) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// A per-second live region is unusable with a screen reader, so the ticking digits are
// aria-hidden and the accessible name is the fixed closing time.
function staticDeadline(source: string | null | undefined) {
  if (!source) {
    return null;
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date);
}

export function DropClock({
  className,
  source,
}: Readonly<{ className?: string; source: string | null }>) {
  const motionDisabled = useHydrationSafeMotionDisabled();
  const tick = useReducedTick(1000, !motionDisabled);
  const label = formatClock(source, tick ?? Date.now());
  const deadline = staticDeadline(source);

  if (!label || !deadline) {
    return null;
  }

  if (motionDisabled) {
    return <span className={className}>{deadline}</span>;
  }

  return (
    <span className={className}>
      <span aria-hidden="true" suppressHydrationWarning>
        {label}
      </span>
      <span className="sr-only">Closes {deadline}</span>
    </span>
  );
}
