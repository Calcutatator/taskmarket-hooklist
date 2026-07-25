import type { TaskDropDirectoryItem, TaskDropPageData } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { dropCardCopy, dropCardCopyFromDirectory } from './og-drop';

const NOW = Date.parse('2026-07-25T00:00:00.000Z');
const LATER = '2026-07-28T00:00:00.000Z';
const EARLIER = '2026-07-20T00:00:00.000Z';

function task(overrides: Partial<TaskDropPageData['tasks'][number]> = {}) {
  return {
    createdAt: '2026-07-24T00:00:00.000Z',
    description: 'A task',
    expiryTime: LATER,
    id: '0xabc',
    mode: 'bounty',
    reward: '5000000',
    status: 'open',
    tags: [],
    ...overrides,
  } as TaskDropPageData['tasks'][number];
}

function pageData(tasks: TaskDropPageData['tasks']): TaskDropPageData {
  return {
    drop: {
      announcedAt: null,
      createdAt: '2026-07-24T00:00:00.000Z',
      description: null,
      id: 'drop_1',
      isOfficial: true,
      name: 'Insects x AI',
      officialWalletAddress: '0x0000000000000000000000000000000000000001',
      ownerAddress: '0x0000000000000000000000000000000000000001',
    },
    tasks,
  } as TaskDropPageData;
}

function directoryItem(overrides: Partial<TaskDropDirectoryItem> = {}) {
  return {
    availableTaskCount: 2,
    drop: pageData([]).drop,
    latestTaskAt: '2026-07-24T00:00:00.000Z',
    nextExpiryTime: LATER,
    resolvedTaskCount: 0,
    taskCount: 2,
    totalReward: '10000000',
    ...overrides,
  } as TaskDropDirectoryItem;
}

describe('dropCardCopy', () => {
  it('leads with the call to action while tasks are still enterable', () => {
    const copy = dropCardCopy(pageData([task(), task()]), NOW);

    expect(copy.badge).toBe('Enter the latest Task Drop:');
    expect(copy.description).toBe('2 open tasks · 10 USDC in prizes');
    expect(copy.title).toBe('Insects x AI');
  });

  // The bug this guards: nothing flips `status` at expiry, so an expired-but-open task would
  // make a finished drop shout "Enter" on its permalink while /live said "judging closed".
  it('treats an expired task as closed even while its status still says open', () => {
    const copy = dropCardCopy(pageData([task({ expiryTime: EARLIER })]), NOW);

    expect(copy.badge).toBe('Task Drop');
    expect(copy.description).toBe('1 task · 5 USDC in prizes · judging closed');
  });

  it('agrees with the directory row for the same drop', () => {
    const fromPage = dropCardCopy(pageData([task(), task()]), NOW);
    const fromDirectory = dropCardCopyFromDirectory(directoryItem());

    expect(fromDirectory.badge).toBe(fromPage.badge);
    expect(fromDirectory.description).toBe(fromPage.description);
  });

  it('says nothing about money when the drop is unfunded', () => {
    const copy = dropCardCopy(pageData([task({ reward: '0' })]), NOW);

    expect(copy.description).toBe('1 open task');
  });

  it('survives a malformed reward rather than losing the card', () => {
    const copy = dropCardCopy(pageData([task({ reward: 'not-a-number' }), task()]), NOW);

    expect(copy.description).toBe('2 open tasks · 5 USDC in prizes');
  });

  it('falls back to a generic Task Drop card when there is no data', () => {
    expect(dropCardCopy(null).title).toBe('The latest Task Drop.');
    expect(dropCardCopyFromDirectory(null).title).toBe('The latest Task Drop.');
  });
});
