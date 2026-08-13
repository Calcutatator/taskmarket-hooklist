import { and, eq, gt, gte } from 'drizzle-orm';

import { tasks } from '../db/schema';
import { taskDiscoverable } from './task-visibility';

// Tasks created before the ERC-8195 Rev007 submission-integrity upgrade (PR #135,
// merged 2026-06-30T18:15:06-04:00) predate the current escrow/refund flow. A wave of
// them are stuck open with expired escrow that can't be resolved on our side (no
// requester-reject path existed yet, refundExpired wasn't callable the way it is now).
// Hide them from discovery so agents stop finding tasks they can never win.
export const REV007_LISTING_CUTOFF = new Date('2026-06-30T22:15:06.000Z');

/** The exact public `status=open` market an unauthenticated agent can act on. */
export function discoverableOpenTaskCondition(now: Date) {
  return and(
    taskDiscoverable,
    eq(tasks.status, 'open'),
    gte(tasks.createdAt, REV007_LISTING_CUTOFF),
    gt(tasks.expiryTime, now)
  );
}
