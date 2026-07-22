import { describe, expect, it } from 'vitest';

import { parseTaskFilters, taskFiltersHref } from './task-filters';

const WORKER = '0x1111111111111111111111111111111111111111';
const REQUESTER = '0x2222222222222222222222222222222222222222';

describe('task filters', () => {
  it('passes worker and requester through parseTaskFilters', () => {
    const filters = parseTaskFilters({ requester: REQUESTER, worker: WORKER });

    expect(filters.requester).toBe(REQUESTER);
    expect(filters.worker).toBe(WORKER);
  });

  it('adds a removable chip for the worker filter using a compact address', () => {
    const filters = parseTaskFilters({ worker: WORKER });

    const chip = filters.activeFilters.find((entry) => entry.label === 'Worker');
    expect(chip).toBeDefined();
    expect(chip?.value).toBe('0x1111...1111');
  });

  it('adds a removable chip for the requester filter using a compact address', () => {
    const filters = parseTaskFilters({ requester: REQUESTER });

    const chip = filters.activeFilters.find((entry) => entry.label === 'Requester');
    expect(chip).toBeDefined();
    expect(chip?.value).toBe('0x2222...2222');
  });

  it('includes worker and requester in taskFiltersHref', () => {
    const href = taskFiltersHref('/tasks', { requester: REQUESTER, worker: WORKER });

    expect(href).toContain(`worker=${WORKER}`);
    expect(href).toContain(`requester=${REQUESTER}`);
  });

  it('clears the worker param when overridden to an empty string', () => {
    const href = taskFiltersHref('/tasks', { worker: WORKER }, { worker: '' });

    expect(href).not.toContain('worker=');
  });

  it('parses, labels, and serializes an exact Task Drop filter', () => {
    const filters = parseTaskFilters({ taskDropId: '  launch-drop  ' });

    expect(filters.taskDropId).toBe('launch-drop');
    expect(filters.activeFilters).toContainEqual({
      label: 'Task Drop',
      value: 'launch-drop',
    });
    expect(taskFiltersHref('/tasks', { taskDropId: 'launch-drop' })).toBe(
      '/tasks?taskDropId=launch-drop'
    );
  });

  it('clears the Task Drop param when overridden to an empty string', () => {
    const href = taskFiltersHref(
      '/tasks',
      { status: 'open', taskDropId: 'launch-drop' },
      { taskDropId: '' }
    );

    expect(href).toBe('/tasks?status=open');
  });

  it('falls back to ALL for a status value that is not a real TaskStatus', () => {
    // e.g. a stale bookmark, crafted URL, or crawler hitting ?status=submitted --
    // 'submitted' is a real enum value, just for ClaimStatus, not TaskStatus. The
    // backend's tasks.list rejects it outright; the web app should never forward it.
    const filters = parseTaskFilters({ status: 'submitted' });

    expect(filters.selectedStatus).toBe('ALL');
    expect(filters.status).toBeUndefined();
    expect(filters.activeFilters.find((entry) => entry.label === 'Status')).toBeUndefined();
  });

  it('accepts a real TaskStatus value unchanged', () => {
    const filters = parseTaskFilters({ status: 'open' });

    expect(filters.selectedStatus).toBe('open');
    expect(filters.status).toBe('open');
  });
});
