import { cn } from '@/lib/utils';

type AccessibleChartSeries = {
  key: string;
  label: string;
};

// Header for the x column when a caller has not named it. `xKey` is a raw data
// key ("bucket", "label"), which is what a screen reader would otherwise
// announce, so fall back to a generic human word instead. Callers should pass
// `xLabel` with the real name of the dimension.
const DEFAULT_X_LABEL = 'Category';

// Pinned locale, for the same reason lib/charts/axis-format.ts pins one: this
// table is server-rendered, and an ambient locale formats differently on the
// Node server than in a non-en-US browser, which is a hydration mismatch. Not
// lib/format's formatNumber, which compacts large values ("12.3K") — the table
// is the accessible equivalent of the chart's data, so it keeps full precision.
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function AccessibleChartTable<T extends Record<string, unknown>>({
  ariaLabel,
  data,
  xKey,
  xLabel,
  series,
  valueFormatter,
  className,
}: {
  ariaLabel: string;
  data: T[];
  xKey: keyof T & string;
  /** Human-readable name of the x dimension, announced as its column header. */
  xLabel?: string;
  series: AccessibleChartSeries[];
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  return (
    <table className={cn('sr-only', className)}>
      <caption>{ariaLabel} data</caption>
      <thead>
        <tr>
          <th scope="col">{xLabel ?? DEFAULT_X_LABEL}</th>
          {series.map((entry) => (
            <th key={entry.key} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={`${String(row[xKey])}-${index}`}>
            <th scope="row">{String(row[xKey] ?? '')}</th>
            {series.map((entry) => {
              const value = row[entry.key];
              const numericValue = typeof value === 'number' ? value : Number.NaN;
              return (
                <td key={entry.key}>
                  {Number.isFinite(numericValue)
                    ? (valueFormatter?.(numericValue) ?? NUMBER_FORMAT.format(numericValue))
                    : 'No data'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
