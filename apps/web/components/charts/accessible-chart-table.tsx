import { cn } from '@/lib/utils';

type AccessibleChartSeries = {
  key: string;
  label: string;
};

export function AccessibleChartTable<T extends Record<string, unknown>>({
  ariaLabel,
  data,
  xKey,
  series,
  valueFormatter,
  className,
}: {
  ariaLabel: string;
  data: T[];
  xKey: keyof T & string;
  series: AccessibleChartSeries[];
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  return (
    <table className={cn('sr-only', className)}>
      <caption>{ariaLabel} data</caption>
      <thead>
        <tr>
          <th scope="col">{xKey}</th>
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
                    ? (valueFormatter?.(numericValue) ?? numericValue.toLocaleString())
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
