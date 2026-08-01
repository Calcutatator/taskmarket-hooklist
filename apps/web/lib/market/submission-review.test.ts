import type { SubmissionResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { groupSubmissionsByWorker, sortSubmissionGroups } from './submission-review';

function submission(
  id: string,
  workerAddress: string,
  submittedAt: string,
  overrides: Partial<SubmissionResponse> = {}
): SubmissionResponse {
  return {
    id,
    taskId: 'task-1',
    workerAddress,
    fileUrl: `https://example.com/${id}`,
    signature: `signature-${id}`,
    submittedAt,
    artifacts: [],
    ...overrides,
  };
}

describe('groupSubmissionsByWorker', () => {
  it('groups normalized worker addresses and returns representative submission counts', () => {
    const older = submission('submission-1', '0xAbC', '2026-07-01T10:00:00.000Z');
    const newest = submission('submission-2', '0xaBc', '2026-07-03T10:00:00.000Z', {
      workerStats: {
        completedTasks: 8,
        ratedTasks: 4,
        totalStars: 18,
        averageRating: 4.5,
      },
    });
    const other = submission('submission-3', '0xDEF', '2026-07-02T10:00:00.000Z');
    const input = [older, newest, other] as const;

    const result = groupSubmissionsByWorker(input);

    expect(result).toMatchObject({
      activeSubmissionCount: 3,
      rejectedSubmissionCount: 0,
      totalSubmissionCount: 3,
    });
    expect(result.rejectedGroups).toEqual([]);
    expect(result.activeGroups).toHaveLength(2);
    expect(result.activeGroups[0]).toEqual({
      workerKey: '0xabc',
      workerAddress: '0xaBc',
      submissions: [newest, older],
      representativeSubmission: newest,
      firstSubmittedAt: '2026-07-01T10:00:00.000Z',
      latestSubmittedAt: '2026-07-03T10:00:00.000Z',
      rejected: false,
      workerStats: newest.workerStats,
    });
    expect(result.activeGroups[1]?.workerKey).toBe('0xdef');
    expect(input).toEqual([older, newest, other]);
  });

  it('classifies an entire normalized worker group as rejected when any row is rejected', () => {
    const activeRow = submission('submission-1', '0xAbC', '2026-07-03T10:00:00.000Z');
    const rejectedRow = submission('submission-2', '0xaBc', '2026-07-01T10:00:00.000Z', {
      rejectedAt: '2026-07-02T10:00:00.000Z',
    });
    const activeWorker = submission('submission-3', '0xDEF', '2026-07-02T10:00:00.000Z');

    const result = groupSubmissionsByWorker([activeRow, rejectedRow, activeWorker]);

    expect(result.activeGroups.map((group) => group.workerKey)).toEqual(['0xdef']);
    expect(result.rejectedGroups).toHaveLength(1);
    expect(result.rejectedGroups[0]).toMatchObject({
      workerKey: '0xabc',
      submissions: [activeRow, rejectedRow],
      representativeSubmission: activeRow,
      rejected: true,
    });
    expect(result).toMatchObject({
      activeSubmissionCount: 1,
      rejectedSubmissionCount: 2,
      totalSubmissionCount: 3,
    });
  });

  it('orders submissions newest first with stable timestamp and ID fallbacks', () => {
    const sameTimeB = submission('submission-b', '0xABC', '2026-07-02T10:00:00.000Z');
    const invalidA = submission('invalid-a', '0xabc', 'not-a-date');
    const newest = submission('newest', '0xAbC', '2026-07-03T10:00:00.000Z');
    const invalidB = submission('invalid-b', '0xABC', 'also-not-a-date');
    const sameTimeA = submission('submission-a', '0xabc', '2026-07-02T10:00:00.000Z');

    const result = groupSubmissionsByWorker([sameTimeB, invalidA, newest, invalidB, sameTimeA]);

    expect(result.activeGroups[0]?.submissions.map(({ id }) => id)).toEqual([
      'newest',
      'submission-a',
      'submission-b',
      'invalid-a',
      'invalid-b',
    ]);
    expect(result.activeGroups[0]).toMatchObject({
      firstSubmittedAt: '2026-07-02T10:00:00.000Z',
      latestSubmittedAt: '2026-07-03T10:00:00.000Z',
    });
  });

  it('collapses 150 submissions from one worker into one review group', () => {
    const submissions = Array.from({ length: 150 }, (_, index) =>
      submission(
        `submission-${String(index).padStart(3, '0')}`,
        index % 2 === 0 ? '0xAbC' : '0xaBc',
        new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString()
      )
    );

    const result = groupSubmissionsByWorker(submissions);

    expect(result.activeGroups).toHaveLength(1);
    expect(result.activeGroups[0]?.submissions).toHaveLength(150);
    expect(result.activeSubmissionCount).toBe(150);
  });
});

describe('sortSubmissionGroups', () => {
  const groups = groupSubmissionsByWorker([
    submission('alpha-first', '0xAAA', '2026-07-01T10:00:00.000Z', {
      workerStats: {
        completedTasks: 8,
        ratedTasks: 5,
        totalStars: 23,
        averageRating: 4.6,
      },
    }),
    submission('alpha-revision', '0xaaa', '2026-07-05T10:00:00.000Z', {
      workerStats: {
        completedTasks: 8,
        ratedTasks: 5,
        totalStars: 23,
        averageRating: 4.6,
      },
    }),
    submission('charlie', '0xCCC', '2026-07-03T10:00:00.000Z', {
      workerStats: {
        completedTasks: 10,
        ratedTasks: 7,
        totalStars: 33,
        averageRating: 4.7,
      },
    }),
    submission('bravo', '0xBBB', '2026-07-03T10:00:00.000Z', {
      workerStats: {
        completedTasks: 8,
        ratedTasks: 4,
        totalStars: 18,
        averageRating: 4.5,
      },
    }),
    submission('invalid', '0xDDD', 'not-a-date'),
  ]).activeGroups;

  it('sorts newest submitters by first arrival without mutating the groups', () => {
    const originalOrder = groups.map(({ workerKey }) => workerKey);

    const result = sortSubmissionGroups(groups, 'newest');

    expect(result.map(({ workerKey }) => workerKey)).toEqual(['0xbbb', '0xccc', '0xaaa', '0xddd']);
    expect(groups.map(({ workerKey }) => workerKey)).toEqual(originalOrder);
    expect(result).not.toBe(groups);
  });

  it('sorts oldest submitters by first arrival and puts invalid timestamps last', () => {
    expect(sortSubmissionGroups(groups, 'oldest').map(({ workerKey }) => workerKey)).toEqual([
      '0xaaa',
      '0xbbb',
      '0xccc',
      '0xddd',
    ]);
  });

  it('sorts credibility by experience, first arrival, then normalized worker address', () => {
    expect(sortSubmissionGroups(groups, 'credibility').map(({ workerKey }) => workerKey)).toEqual([
      '0xccc',
      '0xaaa',
      '0xbbb',
      '0xddd',
    ]);
  });
});
