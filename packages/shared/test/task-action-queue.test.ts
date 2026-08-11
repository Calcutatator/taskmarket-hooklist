import { describe, expect, it } from 'vitest';
import { TaskActionQueueResponseSchema } from '../src/schemas/task.schemas';

const task = {
  id: 'task-review',
  requester: '0xRequester',
  requesterPubkey: null,
  description: 'Review this work',
  reward: '1000000',
  escrowTxHash: '0xescrow',
  createdAt: '2026-08-01T00:00:00.000Z',
  expiryTime: '2026-08-08T00:00:00.000Z',
  status: 'open',
  tags: [],
  mode: 'bounty',
  taskVisibility: 'public',
  submissionVisibility: 'public',
  stakeRequired: false,
  stakeBps: 0,
  pitchDeadline: null,
  bidDeadline: null,
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  claimedBy: null,
  claimedAt: null,
  platformFeeBps: 500,
  submissionCount: 2,
  pitchCount: 0,
  submissionWindowOpen: true,
  phase: 'active',
};

const action = (name: 'accept' | 'accept_submissions' | 'reject_submission' | 'rate') => ({
  role: 'requester' as const,
  action: name,
  command: `taskmarket task ${name} task-review`,
  eligibleAddress: '0xRequester',
  requiresPayment: true,
  paymentAmount: '1000',
  availableAfter: null,
  availableUntil: null,
  targetWorker: name === 'rate' ? '0xWorker' : null,
});

describe('TaskActionQueueResponseSchema', () => {
  it('accepts one review intent containing alternative lifecycle actions', () => {
    const result = TaskActionQueueResponseSchema.parse({
      items: [
        {
          id: 'task-review:review_work',
          task,
          role: 'requester',
          intent: 'review_work',
          actions: [action('accept'), action('accept_submissions'), action('reject_submission')],
          priority: 'required',
          dueAt: null,
          progress: { completed: 0, total: 2 },
        },
      ],
      total: 1,
      urgentTotal: 0,
      waiting: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.actions).toHaveLength(3);
  });

  it('rejects progress where completed work exceeds the target total', () => {
    const result = TaskActionQueueResponseSchema.safeParse({
      items: [
        {
          id: 'task-review:rate_workers',
          task: { ...task, status: 'completed', phase: 'resolved' },
          role: 'requester',
          intent: 'rate_workers',
          actions: [action('rate')],
          priority: 'follow_up',
          dueAt: null,
          progress: { completed: 2, total: 1 },
        },
      ],
      total: 1,
      urgentTotal: 0,
      waiting: [],
    });

    expect(result.success).toBe(false);
  });
});
