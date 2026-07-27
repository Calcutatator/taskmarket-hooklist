'use client';

import { useEffect, useRef, useState } from 'react';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { formatNumber, formatUsdcStatAmount } from '@/lib/format';

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);
export type CountUpFormat = 'number' | 'usdc-stat';

export function CountUpNumber({
  className,
  duration = 1100,
  format,
  formatStyle,
  value,
}: {
  className?: string;
  duration?: number;
  format?: (value: number) => string;
  formatStyle?: CountUpFormat;
  value: number;
}) {
  const motionDisabled = useMotionDisabled();
  const previousValue = useRef(0);
  const [displayValue, setDisplayValue] = useState(value);
  const formatValue = (nextValue: number) => {
    if (format) return format(nextValue);
    if (formatStyle === 'number') return formatNumber(nextValue);
    if (formatStyle === 'usdc-stat') return formatUsdcStatAmount(nextValue);
    return String(nextValue);
  };

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const startValue = previousValue.current;
    previousValue.current = target;

    if (motionDisabled) {
      setDisplayValue(target);
      return;
    }

    let animationFrame = 0;
    const startedAt = performance.now();

    const update = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      setDisplayValue(startValue + (target - startValue) * easeOutCubic(progress));

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(update);
      }
    };

    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [duration, motionDisabled, value]);

  return (
    <span aria-label={formatValue(value)} className={className} data-slot="count-up-number">
      <span aria-hidden="true">{formatValue(displayValue)}</span>
    </span>
  );
}
