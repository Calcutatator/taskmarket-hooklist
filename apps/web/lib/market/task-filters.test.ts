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
});
