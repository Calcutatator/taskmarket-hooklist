'use client';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { useReducedTick } from '@/components/market/motion/use-reduced-tick';
import { formatTimeLeft, type DeadlineUrgency } from '@/lib/format';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function urgencyTone(urgency: DeadlineUrgency) {
  if (urgency === 'expired') {
    return 'text-destructive';
  }
  if (urgency === 'soon') {
    return 'text-warning';
  }
  return 'text-muted-foreground';
}

// Far-out deadlines only need a coarse re-check; near the wire we tick to the minute.
// A multi-day "Xd left" re-rendering every second would be wasted work.
function tickInterval(source: string | null | undefined, now: number) {
  if (!source) {
    return HOUR_MS;
  }
  const diff = new Date(source).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return HOUR_MS;
  }
  return diff < HOUR_MS ? MINUTE_MS : 15 * MINUTE_MS;
}

// A deadline countdown that re-ticks adaptively after mount and colours itself by
// urgency. Under reduced motion it renders the frozen label, matching the prior
// static behaviour. suppressHydrationWarning covers a label that crosses a boundary
// between server render and hydration.
export function CountdownTimer({
  className,
  source,
  title,
}: {
  className?: string;
  source?: string | null;
  title?: string;
}) {
  const motionDisabled = useMotionDisabled();
  const tick = useReducedTick(tickInterval(source, Date.now()), !motionDisabled);
  const now = tick ?? Date.now();
  const { label, urgency } = formatTimeLeft(source, now);

  return (
    <span
      className={`${urgencyTone(urgency)} ${className ?? ''}`}
      suppressHydrationWarning
      title={title}
    >
      {label}
    </span>
  );
}
