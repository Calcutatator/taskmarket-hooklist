import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printError: vi.fn(),
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

// Phase 3 (ADR-0030): pitches/proofs now sign read-auth and attach any cached
// task-access grant, same as get.ts/submissions.ts -- stub both so these tests assert
// against a deterministic, environment-independent set of headers rather than
// depending on whatever real keystore/grant cache happens to exist on the machine.
vi.mock('../../src/lib/read-auth.js', () => ({
  signReadAuth: vi.fn(),
}));

vi.mock('../../src/lib/task-access-grants.js', () => ({
  taskAccessGrantHeaders: vi.fn(),
}));

import { pitchesCmd } from '../../src/commands/task/pitches.js';
import { proofsCmd } from '../../src/commands/task/proofs.js';
import { apiGet } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';
import { signReadAuth } from '../../src/lib/read-auth.js';
import { taskAccessGrantHeaders } from '../../src/lib/task-access-grants.js';

describe('task collection commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signReadAuth).mockResolvedValue(null);
    vi.mocked(taskAccessGrantHeaders).mockResolvedValue({});
  });

  it('lists pitches through the public REST route, with read-auth/grant headers attached', async () => {
    vi.mocked(apiGet).mockResolvedValue([{ id: 'pitch' }]);
    await pitchesCmd.parseAsync(['node', 'pitches', '0xtask'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/tasks/0xtask/pitches', { headers: {} });
    expect(printResult).toHaveBeenCalledWith([{ id: 'pitch' }]);
  });

  it('lists proofs through the public REST route, with read-auth/grant headers attached', async () => {
    vi.mocked(apiGet).mockResolvedValue([{ id: 'proof' }]);
    await proofsCmd.parseAsync(['node', 'proofs', '0xtask'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/tasks/0xtask/proofs', { headers: {} });
    expect(printResult).toHaveBeenCalledWith([{ id: 'proof' }]);
  });

  it('attaches wallet read-auth headers and a cached task-access grant header when both are available', async () => {
    vi.mocked(signReadAuth).mockResolvedValue({
      walletAddress: '0xabc',
      headers: { 'X-Taskmarket-Caller-Address': '0xabc', 'X-Taskmarket-Caller-Signature': '0xsig' },
    });
    vi.mocked(taskAccessGrantHeaders).mockResolvedValue({
      'X-Taskmarket-Task-Access-Grant': 'tmtpa_grant',
    });
    vi.mocked(apiGet).mockResolvedValue([{ id: 'pitch' }]);

    await pitchesCmd.parseAsync(['node', 'pitches', '0xtask'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/tasks/0xtask/pitches', {
      headers: {
        'X-Taskmarket-Caller-Address': '0xabc',
        'X-Taskmarket-Caller-Signature': '0xsig',
        'X-Taskmarket-Task-Access-Grant': 'tmtpa_grant',
      },
    });
  });
});
