import { describe, it, expect } from 'vitest';
import { diffTaskStatuses, collectNewTaskIds } from '../../src/commands/daemon.js';

const makeTask = (id: string) => ({
  id,
  description: 'test task',
  reward: '5000000',
  mode: 'bounty',
  status: 'open',
  tags: [],
});

describe('diffTaskStatuses', () => {
  it('returns empty array when no statuses have changed', () => {
    const prev = new Map([
      ['0xabc', 'open'],
      ['0xdef', 'pending_approval'],
    ]);
    const next = new Map([
      ['0xabc', 'open'],
      ['0xdef', 'pending_approval'],
    ]);
    expect(diffTaskStatuses(prev, next)).toEqual([]);
  });

  it('returns changed entry', () => {
    const prev = new Map([['0xabc', 'open']]);
    const next = new Map([['0xabc', 'pending_approval']]);
    expect(diffTaskStatuses(prev, next)).toEqual([
      { taskId: '0xabc', from: 'open', to: 'pending_approval' },
    ]);
  });

  it('ignores tasks present in next but not in prev (newly tracked)', () => {
    const prev = new Map<string, string>();
    const next = new Map([['0xabc', 'open']]);
    expect(diffTaskStatuses(prev, next)).toEqual([]);
  });

  it('ignores tasks present in prev but not in next', () => {
    const prev = new Map([['0xabc', 'open']]);
    const next = new Map<string, string>();
    expect(diffTaskStatuses(prev, next)).toEqual([]);
  });

  it('handles multiple simultaneous changes', () => {
    const prev = new Map([
      ['0xabc', 'open'],
      ['0xdef', 'open'],
      ['0x123', 'completed'],
    ]);
    const next = new Map([
      ['0xabc', 'pending_approval'],
      ['0xdef', 'open'],
      ['0x123', 'completed'],
    ]);
    expect(diffTaskStatuses(prev, next)).toEqual([
      { taskId: '0xabc', from: 'open', to: 'pending_approval' },
    ]);
  });

  it('handles multiple tasks changing at once', () => {
    const prev = new Map([
      ['0xabc', 'open'],
      ['0xdef', 'open'],
    ]);
    const next = new Map([
      ['0xabc', 'closed'],
      ['0xdef', 'completed'],
    ]);
    const result = diffTaskStatuses(prev, next);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ taskId: '0xabc', from: 'open', to: 'closed' });
    expect(result).toContainEqual({ taskId: '0xdef', from: 'open', to: 'completed' });
  });

  it('returns empty array for empty maps', () => {
    expect(diffTaskStatuses(new Map(), new Map())).toEqual([]);
  });
});

describe('collectNewTaskIds', () => {
  it('returns all IDs when seenIds is empty', () => {
    const tasks = [makeTask('0xabc'), makeTask('0xdef'), makeTask('0x123')];
    expect(collectNewTaskIds(tasks, new Set())).toEqual(['0xabc', '0xdef', '0x123']);
  });

  it('returns only unseen IDs', () => {
    const tasks = [makeTask('0xabc'), makeTask('0xdef'), makeTask('0x123')];
    expect(collectNewTaskIds(tasks, new Set(['0xabc']))).toEqual(['0xdef', '0x123']);
  });

  it('returns empty array when all tasks are already seen', () => {
    const tasks = [makeTask('0xabc'), makeTask('0xdef')];
    expect(collectNewTaskIds(tasks, new Set(['0xabc', '0xdef']))).toEqual([]);
  });

  it('returns empty array for empty task list', () => {
    expect(collectNewTaskIds([], new Set())).toEqual([]);
  });

  it('returns empty array for empty task list with non-empty seenIds', () => {
    expect(collectNewTaskIds([], new Set(['0xabc']))).toEqual([]);
  });

  it('preserves order of unseen tasks', () => {
    const tasks = [makeTask('0xaaa'), makeTask('0xbbb'), makeTask('0xccc'), makeTask('0xddd')];
    expect(collectNewTaskIds(tasks, new Set(['0xbbb']))).toEqual(['0xaaa', '0xccc', '0xddd']);
  });
});
