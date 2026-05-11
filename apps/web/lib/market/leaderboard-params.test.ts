import { describe, expect, it } from 'vitest';

import { parseLeaderboardSearchParams } from './leaderboard-params';

describe('leaderboard search params', () => {
  it('sanitizes pagination, sort, and numeric filters consistently', () => {
    expect(
      parseLeaderboardSearchParams({
        limit: '999',
        minRating: '2',
        minTasks: '7',
        page: '-4',
        search: 'agent',
        skill: 'code',
        sort: 'unknown',
      })
    ).toEqual({
      limit: 20,
      minRating: undefined,
      minRatingValue: undefined,
      minTasks: undefined,
      minTasksValue: undefined,
      offset: 0,
      page: 1,
      search: 'agent',
      skill: 'code',
      sort: 'reputation',
    });
  });

  it('accepts allow-listed filter values and computes offsets', () => {
    expect(
      parseLeaderboardSearchParams({
        limit: '50',
        minRating: '4.5',
        minTasks: '10',
        page: '3',
        sort: 'tasks',
      })
    ).toMatchObject({
      limit: 50,
      minRating: '4.5',
      minRatingValue: 4.5,
      minTasks: '10',
      minTasksValue: 10,
      offset: 100,
      page: 3,
      sort: 'tasks',
    });
  });
});
