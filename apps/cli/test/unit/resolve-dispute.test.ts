import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

const TASK = '0xtask0000000000000000000000000000000001';
const WORKER = '0x' + 'aa'.repeat(20);
const WORKER_B = '0x' + 'bb'.repeat(20);

describe('task resolve-dispute command', () => {
  let resolveDisputeCmd: Command;
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

    const mod = await import('../../src/commands/task/resolve-dispute.js');
    resolveDisputeCmd = mod.resolveDisputeCmd;
  });

  it('posts approve verdict with award and prints txHash', async () => {
    mockX402Post.mockResolvedValue({ txHash: '0xresolvetx' });

    await resolveDisputeCmd.parseAsync(
      ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', `${WORKER}:5:1`],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(`/api/tasks/${TASK}/resolve-dispute`, {
      taskId: TASK,
      verdict: 'approve',
      awards: [{ worker: WORKER, amount: '5000000', rank: 1 }],
    });
    expect(mockPrintResult).toHaveBeenCalledWith({ txHash: '0xresolvetx' });
  });

  it('posts partial verdict with multiple awards', async () => {
    mockX402Post.mockResolvedValue({ txHash: '0xresolvetx' });

    await resolveDisputeCmd.parseAsync(
      [
        'node',
        'resolve-dispute',
        TASK,
        '--verdict',
        'partial',
        '--award',
        `${WORKER}:3:1`,
        '--award',
        `${WORKER_B}:2:2`,
      ],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(
      `/api/tasks/${TASK}/resolve-dispute`,
      expect.objectContaining({
        verdict: 'partial',
        awards: [
          { worker: WORKER, amount: '3000000', rank: 1 },
          { worker: WORKER_B, amount: '2000000', rank: 2 },
        ],
      })
    );
  });

  it('rejects invalid verdict', async () => {
    await resolveDisputeCmd.parseAsync(
      ['node', 'resolve-dispute', TASK, '--verdict', 'reject', '--award', `${WORKER}:5:1`],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith('--verdict must be "approve" or "partial"');
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects malformed award entry', async () => {
    await resolveDisputeCmd.parseAsync(
      ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', 'badentry'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid --award value'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects invalid worker address in award', async () => {
    await resolveDisputeCmd.parseAsync(
      ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', 'notanaddr:5:1'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid worker address'));
  });

  it('rejects non-integer rank', async () => {
    await resolveDisputeCmd.parseAsync(
      ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', `${WORKER}:5:0`],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid rank'));
  });

  it('propagates errors from x402Post', async () => {
    mockX402Post.mockRejectedValueOnce(new Error('Task is not in Disputed state'));

    await expect(
      resolveDisputeCmd.parseAsync(
        ['node', 'resolve-dispute', TASK, '--verdict', 'approve', '--award', `${WORKER}:5:1`],
        { from: 'node' }
      )
    ).rejects.toThrow('Task is not in Disputed state');
  });
});
