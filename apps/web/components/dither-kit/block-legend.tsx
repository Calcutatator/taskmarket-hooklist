'use client';

import type { ChartConfig } from './chart-context';
import { cn } from './lib';

/**
 * The chart legend: an in-flow key rendered as a sibling of the plot, so it can
 * never overlap it at any width.
 *
 * It is a plain list, not a set of controls — the charts have no series
 * selection to toggle, and a legend of buttons that only redraw themselves would
 * be a keyboard stop with nothing behind it. Per-point values are read from the
 * plot itself (tooltip / keyboard readout) and from the accessible data table
 * each chart adapter renders.
 *
 * It needs no chart context: feed it the same `config` you pass the chart, and
 * optionally a `values` map to show a number beside each entry (e.g. allocation
 * shares or totals).
 */
export function BlockLegend({
  config,
  values,
  valueFormatter = (v) => String(v),
  align = 'start',
  className,
}: {
  config: ChartConfig;
  values?: Record<string, number>;
  valueFormatter?: (value: number) => string;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'flex flex-wrap gap-x-4 gap-y-1.5 px-1',
        align === 'center' && 'justify-center',
        align === 'end' && 'justify-end',
        className
      )}
    >
      {Object.entries(config).map(([name, entry]) => {
        const value = values?.[name];
        return (
          <li
            key={name}
            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
          >
            <span className="size-2 rounded-[1px]" style={{ backgroundColor: entry.color }} />
            <span>{entry.label ?? name}</span>
            {value !== undefined ? (
              <span className="text-foreground">{valueFormatter(value)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
