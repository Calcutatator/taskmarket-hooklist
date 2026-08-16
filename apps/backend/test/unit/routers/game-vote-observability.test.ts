import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getGameVoteState,
  logSlapChopVote,
  logSlapChopVoteFailure,
  logSlapChopVoteState,
  logSlapChopVoteStateFailure,
  requireSlapChopVoter,
  setGameVote,
} = vi.hoisted(() => ({
  getGameVoteState: vi.fn(),
  logSlapChopVote: vi.fn(),
  logSlapChopVoteFailure: vi.fn(),
  logSlapChopVoteState: vi.fn(),
  logSlapChopVoteStateFailure: vi.fn(),
  requireSlapChopVoter: vi.fn(),
  setGameVote: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({ SLAP_CHOP_RANKING_MODE: 'hot' }),
}));
vi.mock('../../../src/lib/slap-chop-voter-auth', () => ({ requireSlapChopVoter }));
vi.mock('../../../src/lib/slap-chop-observability', () => ({
  logSlapChopArtifactDeliveryFailure: vi.fn(),
  logSlapChopCatalogRead: vi.fn(),
  logSlapChopVote,
  logSlapChopVoteFailure,
  logSlapChopVoteState,
  logSlapChopVoteStateFailure,
  slapChopDurationMs: vi.fn().mockReturnValue(5),
}));
vi.mock('../../../src/services/game-votes', () => {
  class GameVoteError extends Error {
    constructor(readonly code: 'NOT_FOUND', message: string) {
      super(message);
    }
  }
  class GameVoteRateLimitedError extends Error {}
  class GameVoteRateLimitUnavailableError extends Error {}

  return {
    GameVoteError,
    GameVoteRateLimitedError,
    GameVoteRateLimitUnavailableError,
    getGameVoteState,
    setGameVote,
  };
});

import { gamesRouter } from '../../../src/routers/games.router';

function caller() {
  return gamesRouter.createCaller({
    db: {} as never,
    req: {
      headers: { authorization: 'Bearer private-token' },
      ip: '203.0.113.10',
    } as never,
    res: { locals: {} } as never,
    caller: undefined,
    idempotencyKey: undefined,
    taskAccessGrant: undefined,
  });
}

describe('game vote router observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSlapChopVoter).mockResolvedValue('did:privy:voter-private');
  });

  it('records a successful vote without recording the voter, client, or token', async () => {
    vi.mocked(setGameVote).mockResolvedValue({
      downvoteCount: 0,
      gameId: 'game-1',
      netVotes: 1,
      selectedVote: 1,
      upvoteCount: 1,
    });

    await expect(caller().vote({ gameId: 'game-1', value: 1 })).resolves.toMatchObject({
      selectedVote: 1,
    });

    expect(logSlapChopVote).toHaveBeenCalledWith({
      durationMs: 5,
      requestedVote: 'up',
      selectedVote: 'up',
    });
    const serialized = JSON.stringify(logSlapChopVote.mock.calls);
    expect(serialized).not.toContain('did:privy:voter-private');
    expect(serialized).not.toContain('203.0.113.10');
    expect(serialized).not.toContain('private-token');
  });

  it('records vote-state reads without retaining the selected vote or voter identity', async () => {
    vi.mocked(getGameVoteState).mockResolvedValue({
      downvoteCount: 0,
      gameId: 'game-1',
      netVotes: 1,
      selectedVote: 1,
      upvoteCount: 1,
    });

    await expect(caller().voteState({ gameId: 'game-1' })).resolves.toMatchObject({
      selectedVote: 1,
    });

    expect(logSlapChopVoteState).toHaveBeenCalledWith({ durationMs: 5 });
    const serialized = JSON.stringify(logSlapChopVoteState.mock.calls);
    expect(serialized).not.toContain('did:privy:voter-private');
    expect(serialized).not.toContain('selectedVote');
  });

  it('records a bounded authentication failure before rejecting the vote', async () => {
    vi.mocked(requireSlapChopVoter).mockRejectedValueOnce(
      new TRPCError({ code: 'UNAUTHORIZED', message: 'A valid Privy access token is required' })
    );

    await expect(caller().vote({ gameId: 'game-1', value: -1 })).rejects.toThrow(
      'A valid Privy access token is required'
    );

    expect(logSlapChopVoteFailure).toHaveBeenCalledWith({
      durationMs: 5,
      reason: 'unauthorized',
    });
  });

  it('records vote-state authentication failures without logging the token', async () => {
    vi.mocked(requireSlapChopVoter).mockRejectedValueOnce(
      new TRPCError({ code: 'UNAUTHORIZED', message: 'A valid Privy access token is required' })
    );

    await expect(caller().voteState({ gameId: 'game-1' })).rejects.toThrow(
      'A valid Privy access token is required'
    );

    expect(logSlapChopVoteStateFailure).toHaveBeenCalledWith({
      durationMs: 5,
      reason: 'unauthorized',
    });
    expect(JSON.stringify(logSlapChopVoteStateFailure.mock.calls)).not.toContain('private-token');
  });
});
