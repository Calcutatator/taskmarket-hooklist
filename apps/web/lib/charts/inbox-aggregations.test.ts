import type { TaskResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { bucketTasksByDay, statusToBucket, taskStatusDistribution } from './inbox-aggregations';

// A minimal TaskResponse factory: only the fields the aggregations read carry
// meaning, the rest are filled with inert defaults so the shape type-checks.
function makeTask(overrides: Partial<TaskResponse>): TaskResponse {
  return {
    id: 'task-1',
    requester: '0xrequester',
    requesterPubkey: null,
    description: 'A task',
    reward: '0',
    escrowTxHash: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    expiryTime: '2026-06-30T00:00:00.000Z',
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'bounty',
    stakeRequired: false,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 0,
    submissionCount: 0,
    pitchCount: 0,
    ...overrides,
  } as TaskResponse;
}

describe('statusToBucket', () => {
  it('maps raw statuses onto their chart buckets', () => {
    expect(statusToBucket('open')).toBe('open');
    expect(statusToBucket('claimed')).toBe('active');
    expect(statusToBucket('worker_selected')).toBe('active');
    expect(statusToBucket('pending_approval')).toBe('pending');
    expect(statusToBucket('review')).toBe('pending');
    expect(statusToBucket('appealing')).toBe('pending');
    expect(statusToBucket('completed')).toBe('completed');
    expect(statusToBucket('disputed')).toBe('disputed');
    expect(statusToBucket('expired')).toBe('expired');
    expect(statusToBucket('cancelled')).toBe('expired');
  });

  it('falls back to expired for unknown statuses', () => {
    expect(statusToBucket('not_a_real_status')).toBe('expired');
  });
});

describe('bucketTasksByDay', () => {
  it('returns an empty array for empty input', () => {
    expect(bucketTasksByDay([])).toEqual([]);
  });

  it('groups tasks by UTC day, counts them, and sums reward volume', () => {
    const tasks = [
      makeTask({ id: 'a', createdAt: '2026-06-01T03:00:00.000Z', reward: '1000000' }),
      makeTask({ id: 'b', createdAt: '2026-06-01T21:00:00.000Z', reward: '2500000' }),
      makeTask({ id: 'c', createdAt: '2026-06-03T12:00:00.000Z', reward: '500000' }),
    ];

    const result = bucketTasksByDay(tasks);

    expect(result).toEqual([
      { bucket: '2026-06-01', count: 2, volume: 3.5 },
      { bucket: '2026-06-03', count: 1, volume: 0.5 },
    ]);
  });

  it('sorts day buckets ascending regardless of input order', () => {
    const tasks = [
      makeTask({ id: 'late', createdAt: '2026-06-05T00:00:00.000Z' }),
      makeTask({ id: 'early', createdAt: '2026-06-02T00:00:00.000Z' }),
    ];

    expect(bucketTasksByDay(tasks).map((b) => b.bucket)).toEqual(['2026-06-02', '2026-06-05']);
  });

  it('skips tasks with a missing or unparseable timestamp on the chosen key', () => {
    const tasks = [
      makeTask({ id: 'no-claim', claimedAt: null }),
      makeTask({ id: 'bad', claimedAt: 'not-a-date' }),
      makeTask({ id: 'ok', claimedAt: '2026-06-04T00:00:00.000Z' }),
    ];

    const result = bucketTasksByDay(tasks, 'claimedAt');

    expect(result).toEqual([{ bucket: '2026-06-04', count: 1, volume: 0 }]);
  });

  it('treats non-numeric or empty rewards as zero volume', () => {
    const tasks = [makeTask({ id: 'empty', createdAt: '2026-06-01T00:00:00.000Z', reward: '' })];

    expect(bucketTasksByDay(tasks)).toEqual([{ bucket: '2026-06-01', count: 1, volume: 0 }]);
  });
});

describe('taskStatusDistribution', () => {
  it('returns an empty array for empty input', () => {
    expect(taskStatusDistribution([])).toEqual([]);
  });

  it('collapses statuses into non-empty buckets in stable order', () => {
    const tasks = [
      makeTask({ id: '1', status: 'open' }),
      makeTask({ id: '2', status: 'claimed' }),
      makeTask({ id: '3', status: 'worker_selected' }),
      makeTask({ id: '4', status: 'pending_approval' }),
      makeTask({ id: '5', status: 'completed' }),
      makeTask({ id: '6', status: 'completed' }),
    ];

    expect(taskStatusDistribution(tasks)).toEqual([
      { bucket: 'open', label: 'Open', value: 1 },
      { bucket: 'active', label: 'Active', value: 2 },
      { bucket: 'pending', label: 'Pending', value: 1 },
      { bucket: 'completed', label: 'Completed', value: 2 },
    ]);
  });

  it('omits buckets with no tasks', () => {
    const tasks = [makeTask({ id: '1', status: 'open' })];
    const result = taskStatusDistribution(tasks);

    expect(result).toHaveLength(1);
    expect(result.map((d) => d.bucket)).toEqual(['open']);
  });
});
