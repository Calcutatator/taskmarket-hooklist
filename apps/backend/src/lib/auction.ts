/** Minimal shape required for clock price / timestamp calculations. */
export interface AuctionTask {
  bidDeadline: Date | null;
  createdAt: Date;
  maxPrice: string | null;
  auctionStartPrice: string | null;
  auctionFloorPrice: string | null;
  auctionType: string | null;
}

/**
 * Compute the current clock price for dutch/reverse_dutch auction tasks.
 * Returns a bigint in USDC base units, clamped to the valid price range,
 * or null if the task is not a clock-based auction or is missing required fields.
 *
 * Dutch:         descends linearly from maxPrice → auctionFloorPrice over the auction window
 * Reverse Dutch: ascends linearly from auctionStartPrice → maxPrice over the auction window
 */
export function computeClockPrice(task: AuctionTask, now: Date): bigint | null {
  if (!task.bidDeadline || !task.maxPrice) return null;
  const start = task.createdAt.getTime();
  const end = task.bidDeadline.getTime();
  const total = end - start;
  if (total <= 0) return null;

  const elapsed = Math.min(Math.max(now.getTime() - start, 0), total);
  const progress = elapsed / total; // 0.0 at start, 1.0 at deadline

  const maxPrice = BigInt(task.maxPrice);

  if (task.auctionType === 'dutch') {
    const floorPrice = task.auctionFloorPrice ? BigInt(task.auctionFloorPrice) : 0n;
    const range = maxPrice - floorPrice;
    const drop = BigInt(Math.round(Number(range) * progress));
    const price = maxPrice - drop;
    return price < floorPrice ? floorPrice : price;
  }

  if (task.auctionType === 'reverse_dutch') {
    const startPrice = task.auctionStartPrice ? BigInt(task.auctionStartPrice) : 0n;
    const range = maxPrice - startPrice;
    const rise = BigInt(Math.round(Number(range) * progress));
    const price = startPrice + rise;
    return price > maxPrice ? maxPrice : price;
  }

  return null;
}

/**
 * Returns the ISO timestamp at which the auction clock will reach targetPrice,
 * or null if the task is not a clock-based auction or the price is out of range.
 */
export function computePriceTimestamp(task: AuctionTask, targetPrice: bigint): string | null {
  if (!task.bidDeadline || !task.maxPrice) return null;
  const start = task.createdAt.getTime();
  const end = task.bidDeadline.getTime();
  const total = end - start;
  if (total <= 0) return null;

  const maxPrice = BigInt(task.maxPrice);

  if (task.auctionType === 'dutch') {
    const floorPrice = task.auctionFloorPrice ? BigInt(task.auctionFloorPrice) : 0n;
    if (targetPrice <= floorPrice) return task.bidDeadline.toISOString();
    if (targetPrice >= maxPrice) return task.createdAt.toISOString();
    const range = maxPrice - floorPrice;
    if (range === 0n) return null;
    const progressNum = Number(maxPrice - targetPrice) / Number(range);
    return new Date(start + Math.round(progressNum * total)).toISOString();
  }

  if (task.auctionType === 'reverse_dutch') {
    const startPrice = task.auctionStartPrice ? BigInt(task.auctionStartPrice) : 0n;
    if (targetPrice >= maxPrice) return task.bidDeadline.toISOString();
    if (targetPrice <= startPrice) return task.createdAt.toISOString();
    const range = maxPrice - startPrice;
    if (range === 0n) return null;
    const progressNum = Number(targetPrice - startPrice) / Number(range);
    return new Date(start + Math.round(progressNum * total)).toISOString();
  }

  return null;
}
