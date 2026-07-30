import { describe, expect, it, vi } from 'vitest';
import { prepareBackendState } from '../../../src/services/startup-preparation';

// Verifies: ADR-0003 (boot fails fast on indexer/award reconciliation)
describe('backend startup preparation', () => {
  it('hydrates historical tasks before task-award reconciliation', async () => {
    const taskIds = new Set<string>();
    const calls: string[] = [];
    const migrate = vi.fn(async () => {
      calls.push('migrate');
    });
    const catchUpIndexer = vi.fn(async () => {
      calls.push('indexer');
      taskIds.add('historical-task');
    });
    const reconcileTaskAwards = vi.fn(async () => {
      calls.push('awards');
      if (!taskIds.has('historical-task')) throw new Error('missing task row');
    });

    await prepareBackendState({ catchUpIndexer, migrate, reconcileTaskAwards });

    expect(calls).toEqual(['migrate', 'indexer', 'awards']);
  });
});
