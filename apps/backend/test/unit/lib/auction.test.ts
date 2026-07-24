import { describe, it, expect } from 'vitest';
import {
  computeClockPrice,
  computePriceTimestamp,
  type AuctionTask,
} from '../../../src/lib/auction';

const START_MS = 1_000_000;
const END_MS = 1_100_000; // 100_000 ms auction window

function dutchTask(overrides: Partial<AuctionTask> = {}): AuctionTask {
  return {
    auctionType: 'dutch',
    createdAt: new Date(START_MS),
    bidDeadline: new Date(END_MS),
    maxPrice: '1000000',
    auctionFloorPrice: '200000',
    auctionStartPrice: null,
    ...overrides,
  };
}

function reverseDutchTask(overrides: Partial<AuctionTask> = {}): AuctionTask {
  return {
    auctionType: 'reverse_dutch',
    createdAt: new Date(START_MS),
    bidDeadline: new Date(END_MS),
    maxPrice: '1000000',
    auctionFloorPrice: null,
    auctionStartPrice: '200000',
    ...overrides,
  };
}

describe('computeClockPrice - dutch', () => {
  it('starts at maxPrice and descends to the floor across the window', () => {
    const task = dutchTask();
    expect(computeClockPrice(task, new Date(START_MS))).toBe(1_000_000n);
    expect(computeClockPrice(task, new Date(START_MS + 50_000))).toBe(600_000n);
    expect(computeClockPrice(task, new Date(END_MS))).toBe(200_000n);
  });

  it('clamps before the start to maxPrice and after the end to the floor', () => {
    const task = dutchTask();
    expect(computeClockPrice(task, new Date(START_MS - 10_000))).toBe(1_000_000n);
    expect(computeClockPrice(task, new Date(END_MS + 10_000))).toBe(200_000n);
  });

  it('treats a missing floor as zero', () => {
    const task = dutchTask({ auctionFloorPrice: null });
    expect(computeClockPrice(task, new Date(END_MS))).toBe(0n);
  });

  it('returns null when the floor exceeds maxPrice', () => {
    const task = dutchTask({ auctionFloorPrice: '2000000' });
    expect(computeClockPrice(task, new Date(START_MS + 50_000))).toBeNull();
  });
});

describe('computeClockPrice - reverse_dutch', () => {
  it('starts at the start price and ascends to maxPrice across the window', () => {
    const task = reverseDutchTask();
    expect(computeClockPrice(task, new Date(START_MS))).toBe(200_000n);
    expect(computeClockPrice(task, new Date(START_MS + 50_000))).toBe(600_000n);
    expect(computeClockPrice(task, new Date(END_MS))).toBe(1_000_000n);
  });

  it('returns null when the start price exceeds maxPrice', () => {
    const task = reverseDutchTask({ auctionStartPrice: '2000000' });
    expect(computeClockPrice(task, new Date(START_MS + 50_000))).toBeNull();
  });
});

describe('computeClockPrice - guards', () => {
  it('returns null without a bid deadline or max price', () => {
    expect(computeClockPrice(dutchTask({ bidDeadline: null }), new Date(START_MS))).toBeNull();
    expect(computeClockPrice(dutchTask({ maxPrice: null }), new Date(START_MS))).toBeNull();
  });

  it('returns null for a non-positive window', () => {
    const task = dutchTask({ bidDeadline: new Date(START_MS) });
    expect(computeClockPrice(task, new Date(START_MS))).toBeNull();
  });

  it('returns null for non-clock auction types', () => {
    expect(computeClockPrice(dutchTask({ auctionType: 'english' }), new Date(START_MS))).toBeNull();
    expect(computeClockPrice(dutchTask({ auctionType: null }), new Date(START_MS))).toBeNull();
  });
});

describe('computePriceTimestamp - dutch', () => {
  it('returns the moment the descending clock crosses the target price', () => {
    const ts = computePriceTimestamp(dutchTask(), 600_000n);
    expect(ts).toBe(new Date(START_MS + 50_000).toISOString());
  });

  it('clamps a target at or below the floor to the bid deadline', () => {
    expect(computePriceTimestamp(dutchTask(), 200_000n)).toBe(new Date(END_MS).toISOString());
    expect(computePriceTimestamp(dutchTask(), 0n)).toBe(new Date(END_MS).toISOString());
  });

  it('clamps a target at or above maxPrice to creation time', () => {
    expect(computePriceTimestamp(dutchTask(), 1_000_000n)).toBe(new Date(START_MS).toISOString());
    expect(computePriceTimestamp(dutchTask(), 5_000_000n)).toBe(new Date(START_MS).toISOString());
  });
});

describe('computePriceTimestamp - reverse_dutch', () => {
  it('returns the moment the ascending clock crosses the target price', () => {
    const ts = computePriceTimestamp(reverseDutchTask(), 600_000n);
    expect(ts).toBe(new Date(START_MS + 50_000).toISOString());
  });

  it('clamps a target at or above maxPrice to the bid deadline', () => {
    expect(computePriceTimestamp(reverseDutchTask(), 1_000_000n)).toBe(
      new Date(END_MS).toISOString()
    );
  });

  it('clamps a target at or below the start price to creation time', () => {
    expect(computePriceTimestamp(reverseDutchTask(), 200_000n)).toBe(
      new Date(START_MS).toISOString()
    );
  });
});

describe('computePriceTimestamp - guards', () => {
  it('returns null without a bid deadline or max price', () => {
    expect(computePriceTimestamp(dutchTask({ bidDeadline: null }), 600_000n)).toBeNull();
    expect(computePriceTimestamp(dutchTask({ maxPrice: null }), 600_000n)).toBeNull();
  });

  it('returns null for a non-positive window', () => {
    expect(
      computePriceTimestamp(dutchTask({ bidDeadline: new Date(START_MS) }), 600_000n)
    ).toBeNull();
  });

  it('returns null for non-clock auction types', () => {
    expect(computePriceTimestamp(dutchTask({ auctionType: 'english' }), 600_000n)).toBeNull();
  });

  it('round-trips against computeClockPrice at the midpoint', () => {
    const task = dutchTask();
    const ts = computePriceTimestamp(task, 600_000n);
    expect(ts).not.toBeNull();
    expect(computeClockPrice(task, new Date(ts as string))).toBe(600_000n);
  });
});
