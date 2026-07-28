'use client';

import { useCommonChart } from './common-context';
import { cn } from './lib';

/** Noninteractive series/slice legend. Works in every chart family via the
 * shared common context; the adjacent accessible data table carries exact
 * values for keyboard and screen-reader users.
 *
 * Note: this is an absolute overlay pinned to the top of the plot, so it's best
 * for ≤2–3 entries. With more entries (or a narrow container) it wraps onto
 * extra rows that overlay the chart — reach for the in-flow `<BlockLegend>`
 * instead, which renders as a sibling and can't overlap at any width. */
export function Legend({ align = 'right' }: { align?: 'left' | 'center' | 'right' }) {
  const chart = useCommonChart();

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-3 px-1',
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        align === 'left' && 'justify-start'
      )}
    >
      {chart.names.map((name) => {
        const emphasis = chart.selectedDataKey ?? chart.focusDataKey;
        const dimmed = emphasis !== null && emphasis !== name;
        return (
          <span
            key={name}
            className={cn(
              'flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-opacity',
              dimmed && 'opacity-40'
            )}
          >
            <span
              className="size-2 rounded-[1px]"
              style={{ backgroundColor: chart.colorOf(name) }}
            />
            {chart.labelOf(name)}
          </span>
        );
      })}
    </div>
  );
}

Legend.chartLayer = 'dom' as const;
