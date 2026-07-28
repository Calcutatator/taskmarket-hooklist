'use client';

import { isValidElement, type ComponentType, type ReactNode } from 'react';

import { AnimatedNumber } from '@/components/market/motion/animated-number';
import { CountUpNumber } from '@/components/market/motion/count-up-number';
import { Sparkline } from '@/components/charts/sparkline';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type MetricDelta = {
  value: number;
  direction?: 'up' | 'down';
};

export type MetricStatProps = {
  label: string;
  value: number | string;
  format?: (value: number | string) => string;
  unit?: string;
  delta?: MetricDelta;
  deltaFormatter?: (value: number) => string;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  sparkline?: number[];
  animateValue?: boolean;
  countUp?: boolean;
  className?: string;
};

// An icon may be a component type to instantiate with a className (the common
// case: a Tabler/Lucide icon, which is a forwardRef object, not a plain
// function) or an already-rendered node to drop in as-is. A rendered React
// element is detected by isValidElement; everything else is treated as a
// component type so forwardRef and memo icons render correctly.
function isIconComponent(
  icon: MetricStatProps['icon']
): icon is ComponentType<{ className?: string }> {
  if (icon === null || icon === undefined || typeof icon === 'boolean') {
    return false;
  }
  if (typeof icon === 'function') {
    return true;
  }
  if (isValidElement(icon)) {
    return false;
  }
  return typeof icon === 'object';
}

function defaultDeltaFormatter(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}`;
}

// A single metric cell matching the SectionCards treatment: a muted label, a
// large mono tabular-nums value with an optional unit, a bordered icon box, an
// optional coloured delta, and an optional sparkline. The value rolls when it
// changes unless animateValue is false. SSR-safe: AnimatedNumber and Sparkline
// both render static markup under reduced motion and in tests.
export function MetricStat({
  label,
  value,
  format,
  unit,
  delta,
  deltaFormatter = defaultDeltaFormatter,
  icon,
  sparkline,
  animateValue = true,
  countUp = false,
  className,
}: MetricStatProps) {
  const direction = delta?.direction ?? (delta ? (delta.value >= 0 ? 'up' : 'down') : undefined);
  const showSparkline = sparkline !== undefined && sparkline.length >= 2;
  const IconComponent = isIconComponent(icon) ? icon : null;

  return (
    <div className={cn('@container/card grid grid-cols-[1fr_auto] gap-4', className)}>
      <div className="min-w-0 space-y-3">
        <dt className="text-[0.8125rem] font-medium text-muted-foreground">{label}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-3xl font-semibold leading-none tracking-normal text-foreground tabular-nums @[250px]/card:text-[2rem]">
          {animateValue && countUp && typeof value === 'number' ? (
            <CountUpNumber
              format={(nextValue) => (format ? format(nextValue) : String(nextValue))}
              value={value}
            />
          ) : animateValue ? (
            <AnimatedNumber value={value} format={format} />
          ) : (
            <span>{format ? format(value) : value}</span>
          )}
          {unit ? (
            <span className="font-sans text-sm font-semibold uppercase tracking-normal text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </dd>
        {delta || showSparkline ? (
          <div className="flex items-center gap-3">
            {delta ? (
              <span
                className={cn(
                  'font-mono text-xs tabular-nums',
                  direction === 'down' ? 'text-destructive' : 'text-success'
                )}
              >
                {deltaFormatter(delta.value)}
              </span>
            ) : null}
            {showSparkline ? (
              <Sparkline
                data={sparkline}
                color={direction === 'down' ? 'var(--chart-disputed)' : 'var(--chart-1)'}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {icon ? (
        <div className="flex size-8 items-center justify-center rounded-md border border-border/58 bg-background/44 text-muted-foreground">
          {IconComponent ? (
            <IconComponent className="size-4" aria-hidden="true" />
          ) : (
            (icon as ReactNode)
          )}
        </div>
      ) : null}
    </div>
  );
}
