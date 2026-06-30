import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

const TASK = '0xtask0000000000000000000000000000000001';
const WORKER_A = '0x' + 'aa'.repeat(20);
const WORKER_B = '0x' + 'bb'.repeat(20);

describe('task accept-submissions command', () => {
  let acceptSubmissionsCmd: Command;
  let mockX402Post: ReturnType<typeof vi.fn>;
  let mockPrintResult: ReturnType<typeof vi.fn>;
  let mockPrintError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockX402Post = vi.fn();
    mockPrintResult = vi.fn();
    mockPrintError = vi.fn();

    vi.resetModules();
    vi.doMock('../../src/lib/x402.js', () => ({ x402Post: mockX402Post }));
    vi.doMock('../../src/lib/output.js', () => ({
      printResult: mockPrintResult,
      printError: mockPrintError,
    }));

    const mod = await import('../../src/commands/task/accept-submissions.js');
    acceptSubmissionsCmd = mod.acceptSubmissionsCmd;
  });

  it('posts winners and prints accepted count', async () => {
    mockX402Post.mockResolvedValue({ success: true });

    await acceptSubmissionsCmd.parseAsync(
      [
        'node',
        'accept-submissions',
        TASK,
        '--winner',
        `${WORKER_A}:6000`,
        '--winner',
        `${WORKER_B}:4000`,
      ],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(`/api/tasks/${TASK}/accept-submissions`, {
      taskId: TASK,
      winners: [
        { worker: WORKER_A, share: 6000 },
        { worker: WORKER_B, share: 4000 },
      ],
    });
    expect(mockPrintResult).toHaveBeenCalledWith({ accepted: true, winners: 2 });
  });

  it('rejects when shares do not sum to 10000', async () => {
    await acceptSubmissionsCmd.parseAsync(
      ['node', 'accept-submissions', TASK, '--winner', `${WORKER_A}:5000`],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('must sum to 10000'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects invalid winner address', async () => {
    await acceptSubmissionsCmd.parseAsync(
      ['node', 'accept-submissions', TASK, '--winner', 'notanaddr:10000'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid worker address'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects invalid share value', async () => {
    await acceptSubmissionsCmd.parseAsync(
      ['node', 'accept-submissions', TASK, '--winner', `${WORKER_A}:99999`],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid share'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });
});
