import { describe, expect, it } from 'vitest';

import {
  countByPhase,
  deriveDropState,
  entryCount,
  nearestActiveExpiry,
  pickCover,
  sectionOrder,
  statePill,
  totalEntries,
  totalWinners,
  type DropTask,
  type DropTaskPhase,
} from './drop-state';

function task(phase: DropTaskPhase, overrides: Partial<DropTask> = {}): DropTask {
  return {
    acceptsEntries: false,
    cover: null,
    entries: 0,
    expiryTime: '2026-07-27T00:00:00.000Z',
    id: `task-${phase}`,
    mode: 'bounty',
    phase,
    reward: '1000000',
    title: 'A task',
    winners: [],
    workIsPublic: true,
    ...overrides,
  };
}

describe('deriveDropState', () => {
  it('reads upcoming when the drop has no tasks yet', () => {
    expect(deriveDropState([])).toBe('upcoming');
  });

  it('reads live while any task is still active', () => {
    expect(deriveDropState([task('resolved'), task('active', { acceptsEntries: true })])).toBe(
      'live'
    );
  });

  it('does not call pending approval open for entries', () => {
    expect(deriveDropState([task('active', { acceptsEntries: false })])).toBe('settling');
  });

  it('distinguishes work under review from work awaiting settlement', () => {
    expect(deriveDropState([task('resolved'), task('awaiting_settlement')])).toBe('settling');
    expect(deriveDropState([task('in_review')])).toBe('judging');
  });

  it('reads finished only when every task is resolved', () => {
    expect(deriveDropState([task('resolved'), task('resolved')])).toBe('finished');
  });
});

describe('nearestActiveExpiry', () => {
  it('ignores expiries on tasks that are no longer active', () => {
    const tasks = [
      task('resolved', { expiryTime: '2026-07-20T00:00:00.000Z', id: 'a' }),
      task('active', {
        acceptsEntries: true,
        expiryTime: '2026-07-28T00:00:00.000Z',
        id: 'b',
      }),
      task('active', {
        acceptsEntries: true,
        expiryTime: '2026-07-27T00:00:00.000Z',
        id: 'c',
      }),
    ];
    expect(nearestActiveExpiry(tasks)).toBe('2026-07-27T00:00:00.000Z');
  });

  it('returns null on a closed drop rather than a stale date', () => {
    expect(nearestActiveExpiry([task('resolved')])).toBeNull();
  });
});

describe('section order', () => {
  it('leads with the ask while the drop is live', () => {
    const order = sectionOrder('live');
    expect(order.indexOf('enter')).toBeLessThan(order.indexOf('work'));
    expect(order.indexOf('enter')).toBeLessThan(order.indexOf('winners'));
  });

  it('leads with results once the drop is finished', () => {
    const order = sectionOrder('finished');
    expect(order.indexOf('winners')).toBeLessThan(order.indexOf('work'));
    expect(order.indexOf('work')).toBeLessThan(order.indexOf('enter'));
  });

  it('leads with the work while judging', () => {
    const order = sectionOrder('judging');
    expect(order.indexOf('work')).toBeLessThan(order.indexOf('enter'));
  });
});

describe('summaries', () => {
  it('counts by phase', () => {
    const counts = countByPhase([
      task('active', { id: 'a' }),
      task('in_review', { id: 'b' }),
      task('awaiting_settlement', { id: 'c' }),
      task('resolved', { id: 'd' }),
    ]);
    expect(counts).toEqual({ accepting: 0, active: 1, judging: 2, resolved: 1 });
  });

  it('sums entries and winners', () => {
    const tasks = [
      task('resolved', { entries: 12, id: 'a', winners: [winner(1)] }),
      task('resolved', { entries: 5, id: 'b', winners: [winner(1), winner(2)] }),
    ];
    expect(totalEntries(tasks)).toBe(17);
    expect(totalWinners(tasks)).toBe(3);
  });

  it('pluralises the live pill', () => {
    expect(statePill('live', 1)).toBe('LIVE NOW · 1 TASK OPEN');
    expect(statePill('live', 12)).toBe('LIVE NOW · 12 TASKS OPEN');
    expect(statePill('finished', 0)).toBe('FINISHED');
    expect(statePill('upcoming', 0)).toBe('OPENING SOON');
  });
});

describe('entryCount', () => {
  const bounty = (submissionCount: number) => ({ mode: 'bounty', submissionCount });
  const submissions = (count: number, rejected = 0) => [
    ...Array.from({ length: count }, () => ({ rejectedAt: null })),
    ...Array.from({ length: rejected }, () => ({ rejectedAt: '2026-07-26T00:00:00.000Z' })),
  ];

  it('prefers the listing when the counter is stale and under-reports', () => {
    // The INSECTS shape: counter says 214 drop-wide, the listings return 851.
    expect(entryCount(bounty(17), submissions(73))).toBe(73);
  });

  it('prefers the counter when the listing is only partially visible', () => {
    // An ended winner_only task returns just its award-linked rows. Counting those would render a
    // 200-entry task as 3, which is worse than the stale counter and looks plausible.
    expect(entryCount(bounty(200), submissions(3))).toBe(200);
  });

  it('falls back to the counter when the listing is hidden entirely', () => {
    expect(entryCount(bounty(42), [])).toBe(42);
  });

  it('reports zero for a genuinely empty field', () => {
    expect(entryCount(bounty(0), [])).toBe(0);
  });

  it('does not count rejected submissions as entries', () => {
    expect(entryCount(bounty(1), submissions(2, 4))).toBe(2);
  });

  it('uses the mode-specific counter for pitch and auction, never the listing', () => {
    expect(entryCount({ mode: 'pitch', pitchCount: 9, submissionCount: 0 }, submissions(99))).toBe(
      9
    );
    expect(
      entryCount({ auctionBidCount: 4, mode: 'auction', submissionCount: 0 }, submissions(99))
    ).toBe(4);
    expect(entryCount({ auctionBidCount: null, mode: 'auction' }, submissions(99))).toBe(0);
  });

  it('survives a missing task detail', () => {
    expect(entryCount(null, [])).toBe(0);
    expect(entryCount(null, submissions(6))).toBe(6);
  });
});

describe('pickCover', () => {
  const artifact = (id: string, mediaKind: string, previewUrl?: string) =>
    ({ fileName: `${id}.jpg`, id, mediaKind, previewUrl }) as never;

  const submission = (
    workerAddress: string,
    submittedAt: string,
    artifacts: unknown[],
    rejectedAt: string | null = null
  ) => ({ artifacts, rejectedAt, submittedAt, workerAddress }) as never;

  it('skips artifacts with no presigned preview', () => {
    const field = [submission('0xa', '2026-07-01T00:00:00.000Z', [artifact('a', 'image')])];
    expect(pickCover(field)).toBeNull();
  });

  it('skips non-media artifacts', () => {
    const field = [
      submission('0xa', '2026-07-01T00:00:00.000Z', [artifact('a', 'archive', 'https://x/a')]),
    ];
    expect(pickCover(field)).toBeNull();
  });

  it('ignores rejected submissions', () => {
    const field = [
      submission(
        '0xa',
        '2026-07-01T00:00:00.000Z',
        [artifact('a', 'image', 'https://x/a')],
        '2026-07-02T00:00:00.000Z'
      ),
    ];
    expect(pickCover(field)).toBeNull();
  });

  it('prefers the named worker and their latest submission', () => {
    const field = [
      submission('0xother', '2026-07-05T00:00:00.000Z', [artifact('o', 'image', 'https://x/o')]),
      submission('0xWinner', '2026-07-01T00:00:00.000Z', [
        artifact('old', 'image', 'https://x/old'),
      ]),
      submission('0xwinner', '2026-07-04T00:00:00.000Z', [
        artifact('new', 'image', 'https://x/new'),
      ]),
    ];
    expect(pickCover(field, '0xWINNER')?.url).toBe('https://x/new');
  });

  it('reports video covers as video', () => {
    const field = [
      submission('0xa', '2026-07-01T00:00:00.000Z', [artifact('a', 'video', 'https://x/a')]),
    ];
    expect(pickCover(field)?.kind).toBe('video');
  });
});

function winner(rank: number) {
  return { rank, rating: 90, workerAddress: `0x${rank}`, workerAgentId: null };
}
