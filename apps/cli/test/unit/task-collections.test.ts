import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printError: vi.fn(),
  printResult: vi.fn(),
}));

import { pitchesCmd } from '../../src/commands/task/pitches.js';
import { proofsCmd } from '../../src/commands/task/proofs.js';
import { apiGet } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';

describe('task collection commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists pitches through the public REST route', async () => {
    vi.mocked(apiGet).mockResolvedValue([{ id: 'pitch' }]);
    await pitchesCmd.parseAsync(['node', 'pitches', '0xtask'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/tasks/0xtask/pitches');
    expect(printResult).toHaveBeenCalledWith([{ id: 'pitch' }]);
  });

  it('lists proofs through the public REST route', async () => {
    vi.mocked(apiGet).mockResolvedValue([{ id: 'proof' }]);
    await proofsCmd.parseAsync(['node', 'proofs', '0xtask'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/tasks/0xtask/proofs');
    expect(printResult).toHaveBeenCalledWith([{ id: 'proof' }]);
  });
});
