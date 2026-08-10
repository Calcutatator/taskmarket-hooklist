import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xownwallet00000000000000000000000000001' }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { statsCommand } from '../../src/commands/stats.js';
import { apiGet } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';
import { loadKeystore } from '../../src/lib/keystore.js';

const ADDR = '0xownwallet00000000000000000000000000001';

const statsResponse = {
  agentId: 'agent-001',
  address: ADDR,
  completedTasks: 10,
  ratedTasks: 5,
  averageRating: 80,
  credibility: 333,
  totalEarnings: '5000000',
  skills: ['typescript'],
  emailAddress: null,
  recentRatings: [],
};

const balanceResponse = {
  balanceBaseUnits: '10000000',
  balanceUsdc: '10.00',
};

const dreamsResponse = {
  claimableBaseUnits: '0',
};

const exchangeRateResponse = {
  dreamsPerUsdc: '10000000000000000000',
};

describe('stats command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches stats by own wallet address and prints credibility', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(statsResponse)
      .mockResolvedValueOnce(balanceResponse)
      .mockResolvedValueOnce(dreamsResponse)
      .mockResolvedValueOnce(exchangeRateResponse);

    await statsCommand.parseAsync(['node', 'stats'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining(ADDR));
    expect(printResult).toHaveBeenCalledWith(expect.objectContaining({ credibility: 333 }));
  });

  it('includes dreamsPerUsdc and pendingDreamsUsd when claimable and rate are both set', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(statsResponse)
      .mockResolvedValueOnce(balanceResponse)
      .mockResolvedValueOnce({ claimableBaseUnits: (BigInt(500) * BigInt(10 ** 18)).toString() })
      .mockResolvedValueOnce(exchangeRateResponse);

    await statsCommand.parseAsync(['node', 'stats'], { from: 'node' });

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingDreamsRewards: '500',
        dreamsPerUsdc: exchangeRateResponse.dreamsPerUsdc,
        // 500 DREAMS / 10 DREAMS-per-USDC = 50 USDC
        pendingDreamsUsd: '50.000000',
      })
    );
  });

  it('uses --address flag when provided', async () => {
    const OTHER = '0xother000000000000000000000000000000001';
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ ...statsResponse, address: OTHER })
      .mockResolvedValueOnce(balanceResponse)
      .mockResolvedValueOnce(dreamsResponse)
      .mockResolvedValueOnce(exchangeRateResponse);

    await statsCommand.parseAsync(['node', 'stats', '--address', OTHER], { from: 'node' });

    expect(loadKeystore).not.toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining(OTHER));
  });

  it('uses --agent flag to query by agentId', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(statsResponse)
      .mockResolvedValueOnce(balanceResponse)
      .mockResolvedValueOnce(dreamsResponse)
      .mockResolvedValueOnce(exchangeRateResponse);

    await statsCommand.parseAsync(['node', 'stats', '--agent', 'agent-001'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('agentId=agent-001'));
  });

  it('prints emailAddress in output', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ ...statsResponse, emailAddress: 'agent@market.example' })
      .mockResolvedValueOnce(balanceResponse)
      .mockResolvedValueOnce(dreamsResponse)
      .mockResolvedValueOnce(exchangeRateResponse);

    await statsCommand.parseAsync(['node', 'stats'], { from: 'node' });

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({ emailAddress: 'agent@market.example' })
    );
  });
});
