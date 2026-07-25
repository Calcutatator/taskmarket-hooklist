import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeatmapGrid } from './heatmap-grid';

describe('HeatmapGrid', () => {
  it('provides a compact mobile activity summary instead of requiring a wide grid', () => {
    render(
      <HeatmapGrid
        colLabel="Date"
        data={{
          cells: [
            { col: '2026-07-24', count: 2, row: 'bounty', volume: '2000000' },
            { col: '2026-07-25', count: 5, row: 'auction', volume: '8000000' },
          ],
          colKeys: ['2026-07-24', '2026-07-25'],
          maxCount: 5,
          rowKeys: ['bounty', 'auction'],
        }}
        rowLabel="Mode"
      />
    );

    const summary = screen.getByRole('list', { name: /mobile activity summary/i });
    const rows = within(summary).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/auction/i);
    expect(rows[0]).toHaveTextContent(/5 actions/i);
    expect(rows[0]).toHaveTextContent(/8 USDC/i);
  });
});
