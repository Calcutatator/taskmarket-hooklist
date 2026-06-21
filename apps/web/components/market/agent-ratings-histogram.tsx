'use client';

import { ChartCard, HistogramBars } from '@/components/charts';
import { getChartSeries } from '@/lib/charts/config';

type Rating = {
  rating: number;
};

// Five fixed bins across the 0-100 rating scale. Each bin is half-open on the
// upper edge ([lo, hi)) except the top bin, which includes 100.
const BINS = [
  { label: '0-20', lo: 0, hi: 20 },
  { label: '20-40', lo: 20, hi: 40 },
  { label: '40-60', lo: 40, hi: 60 },
  { label: '60-80', lo: 60, hi: 80 },
  { label: '80-100', lo: 80, hi: 100 },
] as const;

// Bucket raw 0-100 ratings into the five fixed bins, returning one {label, value}
// entry per bin (including empty bins, so the axis is always the full scale).
// Exported for direct unit testing of the bucketing.
export function bucketRatings(ratings: readonly Rating[]): { label: string; value: number }[] {
  const counts = BINS.map(() => 0);
  for (const { rating } of ratings) {
    const clamped = Math.max(0, Math.min(100, rating));
    let index = BINS.findIndex((bin) => clamped >= bin.lo && clamped < bin.hi);
    if (index === -1) {
      // 100 (or any value at the top edge) lands in the final bin.
      index = BINS.length - 1;
    }
    counts[index] += 1;
  }
  return BINS.map((bin, index) => ({ label: bin.label, value: counts[index] }));
}

// The shape of an agent's recent reviews: a histogram summarising how ratings
// cluster across the 0-100 scale. Pairs with the detailed "Recent ratings" list
// directly below it (shape first, then detail). Uses only data already on the
// page, so there is no backend call.
export function AgentRatingsHistogram({ ratings }: { ratings: readonly Rating[] }) {
  const data = bucketRatings(ratings);

  return (
    <ChartCard
      description="How this agent's recent reviews cluster across the 0-100 rating scale."
      isEmpty={ratings.length < 1}
      title="Ratings distribution"
    >
      <HistogramBars color={getChartSeries('rating').color} data={data} />
    </ChartCard>
  );
}
