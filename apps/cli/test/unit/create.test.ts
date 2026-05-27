import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

const HOOK = '0x' + 'cc'.repeat(20);
const EVALUATOR = '0x' + 'dd'.repeat(20);
const DISPUTE_RESOLVER = '0x' + 'ee'.repeat(20);

const BASE_ARGS = [
  'node',
  'create',
  '--description',
  'test task',
  '--reward',
  '5',
  '--duration',
  '24',
];

describe('task create command', () => {
  let createCmd: Command;
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

    const mod = await import('../../src/commands/task/create.js');
    createCmd = mod.createCmd;
  });

  it('creates a basic bounty task', async () => {
    mockX402Post.mockResolvedValue({ taskId: '0xtask' });

    await createCmd.parseAsync(BASE_ARGS, { from: 'node' });

    expect(mockX402Post).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ description: 'test task', reward: '5000000', mode: 'bounty' })
    );
    expect(mockPrintResult).toHaveBeenCalledWith({ taskId: '0xtask' });
  });

  it('passes hook contract and hook-data when provided', async () => {
    mockX402Post.mockResolvedValue({ taskId: '0xtask' });

    await createCmd.parseAsync([...BASE_ARGS, '--hook', HOOK, '--hook-data', '0x0004'], {
      from: 'node',
    });

    expect(mockX402Post).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ hookContract: HOOK, hookData: '0x0004' })
    );
  });

  it('rejects invalid hook address', async () => {
    await createCmd.parseAsync([...BASE_ARGS, '--hook', 'notanaddr'], { from: 'node' });

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--hook must be a valid Ethereum address')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects odd-length hook-data', async () => {
    await createCmd.parseAsync([...BASE_ARGS, '--hook-data', '0xabc'], { from: 'node' });

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--hook-data must be a 0x-prefixed hex string with an even number')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('passes evaluator config when evaluator is provided', async () => {
    mockX402Post.mockResolvedValue({ taskId: '0xtask' });

    await createCmd.parseAsync(
      [
        ...BASE_ARGS,
        '--evaluator',
        EVALUATOR,
        '--evaluator-fee-bps',
        '500',
        '--evaluation-window',
        '48',
        '--appeal-window',
        '24',
        '--dispute-resolver',
        DISPUTE_RESOLVER,
      ],
      { from: 'node' }
    );

    expect(mockX402Post).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({
        evaluator: EVALUATOR,
        evaluatorFeeBps: 500,
        evaluationWindowHours: 48,
        appealWindowHours: 24,
        disputeResolver: DISPUTE_RESOLVER,
      })
    );
  });

  it('rejects invalid evaluator address', async () => {
    await createCmd.parseAsync([...BASE_ARGS, '--evaluator', 'badaddr'], { from: 'node' });

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--evaluator must be a valid Ethereum address')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects non-integer evaluator-fee-bps', async () => {
    await createCmd.parseAsync(
      [...BASE_ARGS, '--evaluator', EVALUATOR, '--evaluator-fee-bps', '1.5'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--evaluator-fee-bps must be an integer between 0 and 10000')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects evaluator-fee-bps above 10000', async () => {
    await createCmd.parseAsync(
      [...BASE_ARGS, '--evaluator', EVALUATOR, '--evaluator-fee-bps', '10001'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--evaluator-fee-bps must be an integer between 0 and 10000')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('rejects invalid dispute-resolver address', async () => {
    await createCmd.parseAsync(
      [...BASE_ARGS, '--evaluator', EVALUATOR, '--dispute-resolver', 'badaddr'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--dispute-resolver must be a valid Ethereum address')
    );
    expect(mockX402Post).not.toHaveBeenCalled();
  });

  it('requires --max-price for auction mode', async () => {
    await createCmd.parseAsync(
      [...BASE_ARGS, '--mode', 'auction', '--auction-type', 'dutch'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('--max-price is required'));
  });

  it('requires --auction-type for auction mode', async () => {
    await createCmd.parseAsync([...BASE_ARGS, '--mode', 'auction', '--max-price', '10'], {
      from: 'node',
    });

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--auction-type is required')
    );
  });

  it('rejects invalid auction-type', async () => {
    await createCmd.parseAsync(
      [...BASE_ARGS, '--mode', 'auction', '--max-price', '10', '--auction-type', 'bad'],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--auction-type must be one of')
    );
  });

  it('requires --auction-start-price for reverse_dutch', async () => {
    await createCmd.parseAsync(
      [
        ...BASE_ARGS,
        '--mode',
        'auction',
        '--max-price',
        '10',
        '--auction-type',
        'reverse_dutch',
      ],
      { from: 'node' }
    );

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('--auction-start-price is required')
    );
  });
});
