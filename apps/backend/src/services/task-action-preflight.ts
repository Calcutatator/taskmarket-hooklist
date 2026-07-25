import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PaidPendingActionNameValue } from '@taskmarket/shared';
import { bids, proposals, submissions, taskAwards, tasks } from '../db/schema';
import type { db } from '../db/client';
import { computeClockPrice } from '../lib/auction';

export type PaidTaskAction = PaidPendingActionNameValue;

type Database = typeof db;
type PaidTaskActionRequest = {
  body: unknown;
  params: Record<string, string | undefined>;
};

export class PaidTaskActionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400
  ) {
    super(message);
    this.name = 'PaidTaskActionError';
  }
}

function fail(message: string, status: 400 | 403 | 404 = 400): never {
  throw new PaidTaskActionError(message, status);
}

function requirePayer(payer: string, expected: string | null | undefined, role: string): void {
  if (!expected || payer.toLowerCase() !== expected.toLowerCase()) {
    fail(`Payment payer must be the ${role}`, 403);
  }
}

function bodyString(req: Pick<PaidTaskActionRequest, 'body'>, field: string): string {
  const value = (req.body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

export async function validatePaidTaskAction(
  database: Database,
  action: PaidTaskAction,
  req: PaidTaskActionRequest,
  payer: string,
  now = new Date()
): Promise<void> {
  const taskId = req.params.taskId || bodyString(req, 'taskId');
  const taskRows = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (taskRows.length === 0) fail('Task not found', 404);
  const task = taskRows[0];
  const expired = task.expiryTime <= now;

  switch (action) {
    case 'accept': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.evaluator) fail('Task uses an evaluator; use evaluate instead');
      const worker = bodyString(req, 'worker');
      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        if (task.status !== 'open' && task.status !== 'pending_approval') {
          fail('Task is not accepting a requester decision');
        }
        const active = await database
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(
              eq(submissions.taskId, taskId),
              eq(submissions.workerAddress, worker),
              isNull(submissions.rejectedAt)
            )
          )
          .limit(1);
        if (active.length === 0) fail('No active submission exists for the selected worker');
        return;
      }
      if (expired) fail('Task has expired');
      if (task.mode === 'claim' || task.mode === 'auction') {
        if (task.status !== 'claimed' && task.status !== 'pending_approval') {
          fail('Task is not awaiting acceptance');
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected' && task.status !== 'pending_approval') {
          fail('Task is not awaiting acceptance');
        }
      }
      if (!task.claimedBy || task.claimedBy.toLowerCase() !== worker.toLowerCase()) {
        fail('Selected worker does not match the task worker');
      }
      const delivered = await database
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.taskId, taskId),
            eq(submissions.workerAddress, worker),
            isNull(submissions.rejectedAt)
          )
        )
        .limit(1);
      if (delivered.length === 0) fail('Selected worker has not submitted a deliverable');
      return;
    }
    case 'accept_submissions': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
        fail('Split acceptance is only valid for bounty and benchmark tasks');
      }
      if (task.evaluator) fail('Task uses an evaluator; use evaluate instead');
      if (task.status !== 'open' && task.status !== 'pending_approval') {
        fail('Task is not accepting a requester decision');
      }
      const winners = (req.body as { winners?: Array<{ worker: string; submissionId?: string }> })
        .winners;
      const seenWorkers = new Set<string>();
      for (const winner of winners ?? []) {
        const worker = winner.worker.toLowerCase();
        if (seenWorkers.has(worker)) fail('Duplicate award worker');
        seenWorkers.add(worker);
      }
      const active = await database
        .select({ id: submissions.id, workerAddress: submissions.workerAddress })
        .from(submissions)
        .where(and(eq(submissions.taskId, taskId), isNull(submissions.rejectedAt)));
      for (const winner of winners ?? []) {
        const match = active.some(
          (submission) =>
            submission.workerAddress.toLowerCase() === winner.worker.toLowerCase() &&
            (!winner.submissionId || submission.id === winner.submissionId)
        );
        if (!match) fail(`No active submission exists for winner ${winner.worker}`);
      }
      return;
    }
    case 'rate': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.status !== 'completed') fail('Task is not completed');
      const worker = bodyString(req, 'worker');
      const awards = await database
        .select({ workerAddress: taskAwards.workerAddress, rating: taskAwards.rating })
        .from(taskAwards)
        .where(eq(taskAwards.taskId, taskId));
      const matchingAwards = awards.filter(
        (award) => award.workerAddress.toLowerCase() === worker.toLowerCase()
      );
      if (
        (awards.length > 0 && matchingAwards.length === 0) ||
        (awards.length === 0 && task.claimedBy?.toLowerCase() !== worker.toLowerCase())
      ) {
        fail('Worker is not an award recipient for this task');
      }
      if (matchingAwards.some((award) => award.rating !== null)) {
        fail('Award recipient is already rated');
      }
      return;
    }
    case 'cancel': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.status !== 'open') fail('Task is not open');
      if (task.mode === 'auction') {
        const existing = await database
          .select({ id: bids.id })
          .from(bids)
          .where(eq(bids.taskId, taskId))
          .limit(1);
        if (existing.length > 0) fail('Bids exist; auction cannot be cancelled');
      }
      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const active = await database
          .select({ id: submissions.id })
          .from(submissions)
          .where(and(eq(submissions.taskId, taskId), isNull(submissions.rejectedAt)))
          .limit(1);
        if (active.length > 0) fail('Active submissions exist; accept or reject them first');
      }
      return;
    }
    case 'update': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.status !== 'open') fail('Task is not open');
      if (task.mode === 'auction') {
        const existing = await database
          .select({ id: bids.id })
          .from(bids)
          .where(eq(bids.taskId, taskId))
          .limit(1);
        if (existing.length > 0) fail('Bids exist; auction cannot be updated');
      }
      const update = req.body as {
        reward?: string;
        auctionFloorPrice?: string;
        auctionStartPrice?: string;
      };
      const effectiveReward = BigInt(update.reward ?? task.reward);
      const effectiveFloorPrice = update.auctionFloorPrice ?? task.auctionFloorPrice;
      const effectiveStartPrice = update.auctionStartPrice ?? task.auctionStartPrice;
      if (effectiveFloorPrice != null && BigInt(effectiveFloorPrice) > effectiveReward) {
        fail('auctionFloorPrice must be less than or equal to reward');
      }
      if (effectiveStartPrice != null && BigInt(effectiveStartPrice) > effectiveReward) {
        fail('auctionStartPrice must be less than or equal to reward');
      }
      return;
    }
    case 'reject_submission': {
      requirePayer(payer, task.requester, 'task requester');
      if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
        fail('Submission rejection is only valid for bounty and benchmark tasks');
      }
      if (task.status !== 'open' && task.status !== 'pending_approval') {
        fail('Task is not accepting submission decisions');
      }
      const worker = bodyString(req, 'worker');
      const active = await database
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.taskId, taskId),
            eq(submissions.workerAddress, worker),
            isNull(submissions.rejectedAt)
          )
        )
        .limit(1);
      if (active.length === 0) fail('No active submission exists for the selected worker');
      return;
    }
    case 'refund_expired': {
      if (!expired) fail('Task has not expired');
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'expired') {
        fail(`Task is already ${task.status}`);
      }
      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const active = await database
          .select({ id: submissions.id })
          .from(submissions)
          .where(and(eq(submissions.taskId, taskId), isNull(submissions.rejectedAt)))
          .limit(1);
        if (active.length > 0) fail('Active submissions exist; accept or reject them first');
      }
      return;
    }
    case 'pitch': {
      const worker = bodyString(req, 'workerAddress');
      requirePayer(payer, worker, 'pitch worker');
      if (task.mode !== 'pitch') fail('Task is not a pitch task');
      if (task.status !== 'open') fail('Task is not open for pitches');
      if (expired) fail('Task has expired');
      if (task.pitchDeadline && now > task.pitchDeadline) fail('Pitch deadline has passed');
      const existing = await database
        .select({ id: proposals.id })
        .from(proposals)
        .where(and(eq(proposals.taskId, taskId), eq(proposals.workerAddress, worker)))
        .limit(1);
      if (existing.length > 0) fail('Worker has already submitted a pitch');
      return;
    }
    // Selection is authorized by an EIP-191 signature from the requester
    // (verified in pitches.router.ts), not by payer identity -- the payer
    // settling the X402 fee doesn't have to be the requester. No additional
    // preflight check beyond the shared task-existence lookup above.
    case 'select_worker':
      return;
    case 'submit_proof': {
      const worker = bodyString(req, 'workerAddress');
      requirePayer(payer, worker, 'proof worker');
      if (task.mode !== 'benchmark') fail('Task is not a benchmark task');
      if (task.status !== 'open') fail('Task is not open for proofs');
      if (expired) fail('Task has expired');
      const rejected = await database
        .select({ rejectedAt: submissions.rejectedAt })
        .from(submissions)
        .where(and(eq(submissions.taskId, taskId), eq(submissions.workerAddress, worker)));
      if (rejected.some((submission) => submission.rejectedAt !== null)) {
        fail('This worker was rejected and cannot submit again');
      }
      return;
    }
    case 'bid': {
      if (task.mode !== 'auction') fail('Task is not an auction');
      if (task.status !== 'open') fail('Task is not open for bids');
      if (expired || (task.bidDeadline && now >= task.bidDeadline)) fail('Bid deadline has passed');
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        fail('Clock auctions use auction-accept, not bid');
      }
      const price = BigInt(bodyString(req, 'price'));
      if (task.maxPrice && price > BigInt(task.maxPrice)) fail('Bid exceeds max price');
      if (task.auctionType === 'english') {
        const lowest = await database
          .select({ price: bids.price })
          .from(bids)
          .where(eq(bids.taskId, taskId))
          .orderBy(asc(bids.price))
          .limit(1);
        if (lowest[0] && price >= BigInt(lowest[0].price)) {
          fail('Bid must undercut the current lowest bid');
        }
      }
      if (task.auctionType === 'reverse_english') {
        const ownBid = await database
          .select({ price: bids.price })
          .from(bids)
          .where(and(eq(bids.taskId, taskId), eq(bids.workerAddress, payer)))
          .limit(1);
        if (ownBid[0] && price >= BigInt(ownBid[0].price)) {
          fail('Re-bid must be lower than the worker current bid');
        }
      }
      return;
    }
    case 'auction_accept': {
      if (task.mode !== 'auction') fail('Task is not an auction');
      if (task.auctionType !== 'dutch' && task.auctionType !== 'reverse_dutch') {
        fail('This auction type does not use auction-accept');
      }
      if (task.status !== 'open') fail('Task is not open');
      if (expired || (task.bidDeadline && now >= task.bidDeadline))
        fail('Auction clock has expired');
      const clockPrice = computeClockPrice(task, now);
      if (clockPrice === null) fail('Current auction price is unavailable');
      const minPrice = bodyString(req, 'minPrice');
      if (minPrice && clockPrice < BigInt(minPrice)) fail('Current price is below minPrice');
      return;
    }
    case 'evaluate':
      requirePayer(payer, task.evaluator, 'assigned evaluator');
      if (
        task.status !== 'review' &&
        !(
          (task.mode === 'bounty' || task.mode === 'benchmark') &&
          (task.status === 'open' || task.status === 'pending_approval')
        )
      ) {
        fail('Task is not in an evaluatable state');
      }
      if (
        ((req.body as { awards?: Array<{ amount: string }> }).awards ?? []).reduce(
          (sum, award) => sum + BigInt(award.amount),
          0n
        ) >
        BigInt(task.reward) - (BigInt(task.reward) * BigInt(task.evaluatorFeeBps ?? 0)) / 10_000n
      ) {
        fail('Evaluation awards exceed task escrow');
      }
      return;
    case 'appeal':
      requirePayer(payer, task.claimedBy, 'task worker');
      if (task.status !== 'appealing') fail('Task is not appealable');
      if (task.appealDeadline && now >= task.appealDeadline) fail('Appeal deadline has passed');
      return;
    case 'resolve_dispute':
      requirePayer(payer, task.disputeResolver, 'dispute resolver');
      if (task.status !== 'disputed') fail('Task is not disputed');
      if (
        ((req.body as { awards?: Array<{ amount: string }> }).awards ?? []).reduce(
          (sum, award) => sum + BigInt(award.amount),
          0n
        ) >
        BigInt(task.reward) - (BigInt(task.reward) * BigInt(task.evaluatorFeeBps ?? 0)) / 10_000n
      ) {
        fail('Dispute awards exceed task escrow');
      }
      return;
    case 'evaluator_timeout':
      requirePayer(payer, task.requester, 'task requester');
      if (task.status !== 'review') fail('Task is not in review');
      if (!task.evaluatorDeadline || now <= task.evaluatorDeadline) {
        fail('Evaluator deadline has not passed');
      }
      return;
  }

  const unhandledAction: never = action;
  throw new Error(`Unhandled paid task action: ${unhandledAction}`);
}
