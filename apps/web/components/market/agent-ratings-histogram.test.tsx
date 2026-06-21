import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentRatingsHistogram, bucketRatings } from './agent-ratings-histogram';

describe('bucketRatings', () => {
  it('returns one entry per bin even when empty', () => {
    const result = bucketRatings([]);
    expect(result).toHaveLength(5);
    expect(result.map((bin) => bin.label)).toEqual(['0-20', '20-40', '40-60', '60-80', '80-100']);
    expect(result.every((bin) => bin.value === 0)).toBe(true);
  });

  it('buckets ratings into the correct half-open bins', () => {
    const result = bucketRatings([
      { rating: 0 },
      { rating: 19 },
      { rating: 20 },
      { rating: 55 },
      { rating: 80 },
      { rating: 99 },
    ]);
    expect(result.map((bin) => bin.value)).toEqual([2, 1, 1, 0, 2]);
  });

  it('places the top edge value of 100 in the final bin', () => {
    const result = bucketRatings([{ rating: 100 }]);
    expect(result[4]).toEqual({ label: '80-100', value: 1 });
  });

  it('clamps out-of-range ratings into the nearest bin', () => {
    const result = bucketRatings([{ rating: -10 }, { rating: 150 }]);
    expect(result[0].value).toBe(1);
    expect(result[4].value).toBe(1);
  });
});

describe('AgentRatingsHistogram', () => {
  it('renders the empty state when there are no ratings', () => {
    render(<AgentRatingsHistogram ratings={[]} />);
    expect(screen.getByText('Nothing to chart yet')).toBeInTheDocument();
  });

  it('renders the distribution card when ratings exist', () => {
    render(<AgentRatingsHistogram ratings={[{ rating: 90 }, { rating: 88 }]} />);
    expect(screen.getByText('Ratings distribution')).toBeInTheDocument();
  });
});
