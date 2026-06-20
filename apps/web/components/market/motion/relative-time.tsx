'use client';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { useReducedTick } from '@/components/market/motion/use-reduced-tick';
import { formatDateTime, formatRelativePast } from '@/lib/format';

const MINUTE_MS = 60_000;

// A self-updating "2m ago" timestamp with the absolute time on hover. Re-ticks once
// a minute after mount; relative labels never need finer resolution. Under reduced
// motion it renders the frozen snapshot. suppressHydrationWarning covers the rare
// case where the label crosses a boundary between server render and hydration.
export function RelativeTime({ className, value }: { className?: string; value: string }) {
  const motionDisabled = useMotionDisabled();
  const tick = useReducedTick(MINUTE_MS, !motionDisabled);
  const now = tick ?? Date.now();

  return (
    <time
      className={className}
      dateTime={value}
      suppressHydrationWarning
      title={formatDateTime(value)}
    >
      {formatRelativePast(value, now)}
    </time>
  );
}
