import { describe, expect, it } from 'vitest';

import { commandForTaskWorker } from './task-action-command';

const worker = '0x2222222222222222222222222222222222222222';

describe('commandForTaskWorker', () => {
  it('replaces an existing worker address with the selected worker', () => {
    expect(
      commandForTaskWorker(
        'taskmarket task accept task-1 --worker 0x1111111111111111111111111111111111111111',
        worker
      )
    ).toBe(`taskmarket task accept task-1 --worker ${worker}`);
  });

  it('replaces a worker placeholder with the selected worker', () => {
    expect(commandForTaskWorker('taskmarket task accept task-1 --worker <address>', worker)).toBe(
      `taskmarket task accept task-1 --worker ${worker}`
    );
  });

  it('appends the selected worker when the command has no worker flag', () => {
    expect(commandForTaskWorker('taskmarket task accept task-1', worker)).toBe(
      `taskmarket task accept task-1 --worker ${worker}`
    );
  });
});
