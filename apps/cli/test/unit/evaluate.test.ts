import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';
import type { Command } from 'commander';

const TASK = '0xtask0000000000000000000000000000000001';
const WORKER = '0x' + 'ab'.repeat(20);

describe('task evaluate command', () => {
  let evaluateCmd: Command;
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

    const mod = await import('../../src/commands/task/evaluate.js');
    evaluateCmd = mod.evaluateCmd;
  });

  it('posts approve verdict and prints txHash', async () => {
    mockX402Post.mockResolvedValue(writeOutcome({ txHash: '0xevaluatetx' }));

    await evaluateCmd.parseAsync(['node', 'evaluate', TASK, '--verdict', 'approve'], {
      from: 'node',
    });

    expect(mockX402Post).toHaveBeenCalledWith(
      `/api/tasks/${TASK}/evaluate`,
      expect.objectContaining({ taskId: TASK, verdict: 'approve' })
    );
    expect(mockPrintResult).toHaveBeenCalledWith({ txHash: '0xevaluatetx' }, { idempotencyKey: TEST_IDEMPOTENCY_KEY });
  });

  it('rejects invalid verdict', async () => {
    await evaluateCmd.parseAsync(['node', 'evaluate', TASK, '--verdict', 'wrong'], {
      from: 'node',
    });

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('--verdict must be one of'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('validates evidence-hash must be 32-byte hex', async () => {
    await evaluateCmd.parseAsync(
      ['node', 'evaluate', TASK, '--verdict', 'approve', '--evidence-hash', '0xdeadbeef'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--evidence-hash must be a 0x-prefixed 32-byte hex string')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('accepts valid evidence-hash', async () => {
    mockX402Post.mockResolvedValue(writeOutcome({ txHash: '0xtx' }));
    const hash = '0x' + 'ab'.repeat(32);

    await evaluateCmd.parseAsync(
      ['node', 'evaluate', TASK, '--verdict', 'approve', '--evidence-hash', hash],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(
      `/api/tasks/${TASK}/evaluate`,
      expect.objectContaining({ evidenceHash: hash })
    );
  });

  it('parses --award entries into USDC micro-units', async () => {
    mockX402Post.mockResolvedValue(writeOutcome({ txHash: '0xtx' }));

    await evaluateCmd.parseAsync(
      ['node', 'evaluate', TASK, '--verdict', 'partial', '--award', `${WORKER}:5:1`],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(
      `/api/tasks/${TASK}/evaluate`,
      expect.objectContaining({
        awards: [{ worker: WORKER, amount: '5000000', rank: 1 }],
      })
    );
  });

  it('rejects malformed award entry', async () => {
    await evaluateCmd.parseAsync(
      ['node', 'evaluate', TASK, '--verdict', 'partial', '--award', 'badentry'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid award format'));
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects invalid worker address in award', async () => {
    await evaluateCmd.parseAsync(
      ['node', 'evaluate', TASK, '--verdict', 'partial', '--award', 'notanaddr:5:1'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Invalid worker address'));
  });
});
