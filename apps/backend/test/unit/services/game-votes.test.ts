// Verifies: ADR-0089
import { describe, expect, it, vi } from 'vitest';

import {
  enforceGameVoteRateLimit,
  GAME_VOTE_RATE_LIMIT_PER_IP,
  GAME_VOTE_RATE_LIMIT_PER_USER,
  GameVoteRateLimitUnavailableError,
  GameVoteRateLimitedError,
} from '../../../src/services/game-votes';
import type { Transaction } from '../../../src/lib/rate-limit';
import { makeChain } from '../helpers';

function transactionWithAttempts(
  ...attempts: number[]
): Transaction & { insert: ReturnType<typeof vi.fn> } {
  const insert = vi.fn();
  for (const attempt of attempts) {
    insert.mockReturnValueOnce(makeChain([{ attempts: attempt }]));
  }
  return { insert } as unknown as Transaction & { insert: typeof insert };
}

describe('Slap-Chop vote rate limits', () => {
  it('records independent verified-user and trusted-IP windows', async () => {
    const tx = transactionWithAttempts(1, 1);

    await expect(
      enforceGameVoteRateLimit({
        clientAddress: '203.0.113.10',
        privyUserId: 'did:privy:voter-1',
        tx,
      })
    ).resolves.toBeUndefined();

    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects at the first over-limit dimension without allowing a mutation', async () => {
    const userLimited = transactionWithAttempts(GAME_VOTE_RATE_LIMIT_PER_USER + 1);

    await expect(
      enforceGameVoteRateLimit({
        clientAddress: '203.0.113.10',
        privyUserId: 'did:privy:voter-1',
        tx: userLimited,
      })
    ).rejects.toBeInstanceOf(GameVoteRateLimitedError);
    expect(userLimited.insert).toHaveBeenCalledTimes(1);

    const ipLimited = transactionWithAttempts(1, GAME_VOTE_RATE_LIMIT_PER_IP + 1);
    await expect(
      enforceGameVoteRateLimit({
        clientAddress: '203.0.113.10',
        privyUserId: 'did:privy:voter-2',
        tx: ipLimited,
      })
    ).rejects.toBeInstanceOf(GameVoteRateLimitedError);
    expect(ipLimited.insert).toHaveBeenCalledTimes(2);
  });

  it('fails closed when trusted request IP or rate-limit storage is unavailable', async () => {
    const missingIp = transactionWithAttempts();
    await expect(
      enforceGameVoteRateLimit({
        clientAddress: undefined,
        privyUserId: 'did:privy:voter-1',
        tx: missingIp,
      })
    ).rejects.toBeInstanceOf(GameVoteRateLimitUnavailableError);
    expect(missingIp.insert).not.toHaveBeenCalled();

    const insert = vi.fn(() => {
      throw new Error('database offline');
    });
    const brokenStorage = { insert } as unknown as Transaction;
    await expect(
      enforceGameVoteRateLimit({
        clientAddress: '203.0.113.10',
        privyUserId: 'did:privy:voter-1',
        tx: brokenStorage,
      })
    ).rejects.toBeInstanceOf(GameVoteRateLimitUnavailableError);
  });
});
