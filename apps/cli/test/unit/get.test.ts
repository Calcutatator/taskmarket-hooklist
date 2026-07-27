import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(),
}));

vi.mock('../../src/lib/read-auth.js', () => ({
  signReadAuth: vi.fn(),
}));

vi.mock('../../src/lib/task-access-grants.js', () => ({
  taskAccessGrantHeaders: vi.fn(),
}));

import { getCmd } from '../../src/commands/task/get.js';
import { apiGet } from '../../src/lib/api.js';
import { printResult, printError } from '../../src/lib/output.js';
import { signReadAuth } from '../../src/lib/read-auth.js';
import { taskAccessGrantHeaders } from '../../src/lib/task-access-grants.js';

describe('task get command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signReadAuth).mockResolvedValue(null);
    vi.mocked(taskAccessGrantHeaders).mockResolvedValue({});
  });

  it('prints the task when found', async () => {
    const mockTask = { taskId: '0xtask', status: 'open' };
    vi.mocked(apiGet).mockResolvedValue(mockTask);

    await getCmd.parseAsync(['node', 'get', '0xtask'], { from: 'node' });

    expect(printResult).toHaveBeenCalledWith(mockTask);
    expect(printError).not.toHaveBeenCalled();
  });

  it('hints at task unlock when the task is not found, without claiming it is private', async () => {
    vi.mocked(apiGet).mockResolvedValue(null);

    await getCmd.parseAsync(['node', 'get', '0xtask'], { from: 'node' });

    expect(printError).toHaveBeenCalledWith(
      expect.stringMatching(/task unlock 0xtask --password/)
    );
    // The backend can't distinguish "doesn't exist" from "private, no access" for this
    // response, so the hint must be phrased as a possibility ("or this is a private task"),
    // never asserted as fact -- asserting it would leak that the task actually exists.
    expect(printError).toHaveBeenCalledWith(expect.stringContaining('or this is a private task'));
  });
});
