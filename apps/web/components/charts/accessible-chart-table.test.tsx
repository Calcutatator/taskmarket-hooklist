import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccessibleChartTable } from './accessible-chart-table';

const data = [
  { bucket: '2026-06-21', created: 1234567 },
  { bucket: '2026-06-22', created: 2 },
];

const series = [{ key: 'created', label: 'Tasks created' }];

describe('AccessibleChartTable', () => {
  it('announces the x column by its human-readable name', () => {
    render(
      <AccessibleChartTable
        ariaLabel="Marketplace activity"
        data={data}
        series={series}
        xKey="bucket"
        xLabel="Day"
      />
    );

    const table = screen.getByRole('table', { name: 'Marketplace activity data' });
    expect(within(table).getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'bucket' })).not.toBeInTheDocument();
  });

  it('never falls back to the raw data key as a column header', () => {
    render(
      <AccessibleChartTable
        ariaLabel="Marketplace activity"
        data={data}
        series={series}
        xKey="bucket"
      />
    );

    const table = screen.getByRole('table', { name: 'Marketplace activity data' });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
  });

  it('formats numbers in a fixed locale so the server and client agree', () => {
    // The table is server-rendered: an ambient locale would group 1234567 as
    // "1.234.567" in a de-DE browser against the server's "1,234,567".
    render(
      <AccessibleChartTable
        ariaLabel="Marketplace activity"
        data={data}
        series={series}
        xKey="bucket"
      />
    );

    const table = screen.getByRole('table', { name: 'Marketplace activity data' });
    expect(within(table).getByRole('cell', { name: '1,234,567' })).toBeInTheDocument();
  });

  it('prefers the caller’s formatter and marks non-numeric cells as missing', () => {
    render(
      <AccessibleChartTable
        ariaLabel="Rewards"
        data={[
          { bucket: 'Jun', paid: 4 },
          { bucket: 'Jul', paid: null },
        ]}
        series={[{ key: 'paid', label: 'Paid' }]}
        valueFormatter={(value) => `${value} USDC`}
        xKey="bucket"
        xLabel="Month"
      />
    );

    const table = screen.getByRole('table', { name: 'Rewards data' });
    expect(within(table).getByRole('cell', { name: '4 USDC' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'No data' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Jun' })).toBeInTheDocument();
  });
});
