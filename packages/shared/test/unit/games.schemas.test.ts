import { describe, expect, it } from 'vitest';

import {
  GameDetailResponseSchema,
  GameGetInputSchema,
  GameListInputSchema,
  GameListResponseSchema,
  GameVoteInputSchema,
  GameVoteResponseSchema,
  GameVoteStateInputSchema,
} from '../../src/schemas/games.schemas';
import { TASK_DESCRIPTION_MAX_LENGTH } from '../../src/schemas/task.schemas';

const SHA256 = 'a'.repeat(64);
const KECCAK256 = `0x${'b'.repeat(64)}`;

describe('Slap-Chop Games schemas', () => {
  it('defaults and bounds catalog pagination inputs', () => {
    expect(GameListInputSchema.parse({})).toEqual({ limit: 24 });
    expect(GameListInputSchema.parse({ cursor: 'opaque', limit: 48, query: '  pong  ' })).toEqual({
      cursor: 'opaque',
      limit: 48,
      query: 'pong',
    });
    expect(() => GameListInputSchema.parse({ limit: 49 })).toThrow();
  });

  it('requires lowercase kebab-case public slugs', () => {
    expect(GameGetInputSchema.parse({ slug: '  orbital-pong  ' })).toEqual({ slug: 'orbital-pong' });
    expect(() => GameGetInputSchema.parse({ slug: 'Orbital Pong' })).toThrow();
  });

  it('publishes catalog-only detail DTOs without storage locations', () => {
    const detail = GameDetailResponseSchema.parse({
      id: 'game-1',
      slug: 'orbital-pong',
      title: 'Orbital Pong',
      description: 'A tiny two-player physics game.',
      taskDescription: 'Build a two-player physics game with a stable ball trajectory.',
      creatorName: 'Ari',
      tags: ['arcade', 'physics'],
      coverUrl: 'https://storage.example.test/signed-cover',
      coverAltText: 'A yellow ball between two paddles.',
      upvoteCount: 12,
      downvoteCount: 2,
      netVotes: 10,
      publishedAt: '2026-08-16T00:00:00.000Z',
      source: {
        taskId: 'task-1',
        submissionId: 'submission-1',
        artifactId: 'artifact-1',
        artifactSha256Hash: SHA256,
        artifactKeccak256Hash: KECCAK256,
        artifactMimeType: 'text/html',
        artifactSizeBytes: 1_024,
      },
      artifactUrl: 'https://storage.example.test/signed-game',
      artifactUrlExpiresAt: '2026-08-16T00:05:00.000Z',
      coverStorageUri: 's3://private-bucket/slap-chop-games/covers/private-key.png',
    });

    expect(detail).toMatchObject({
      artifactUrl: 'https://storage.example.test/signed-game',
      source: { artifactId: 'artifact-1', taskId: 'task-1' },
      taskDescription: 'Build a two-player physics game with a stable ball trajectory.',
    });
    expect(detail).not.toHaveProperty('coverStorageUri');
    expect(detail.source).not.toHaveProperty('storageUri');
  });

  it('validates immutable artifact hashes and nullable short-lived delivery URLs', () => {
    const response = GameListResponseSchema.parse({
      games: [
        {
          id: 'game-1',
          slug: 'orbital-pong',
          title: 'Orbital Pong',
          description: null,
          creatorName: null,
          tags: [],
          coverUrl: null,
          coverAltText: null,
          upvoteCount: 0,
          downvoteCount: 0,
          netVotes: 0,
          publishedAt: '2026-08-16T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    expect(response.games[0]?.coverUrl).toBeNull();
    expect(response.games[0]?.taskDescription).toBeUndefined();
    const maximumLengthTaskDescription = 'x'.repeat(TASK_DESCRIPTION_MAX_LENGTH);
    expect(
      GameListResponseSchema.parse({
        ...response,
        games: [{ ...response.games[0]!, taskDescription: maximumLengthTaskDescription }],
      }).games[0]?.taskDescription
    ).toBe(maximumLengthTaskDescription);
    expect(() =>
      GameDetailResponseSchema.parse({
        ...response.games[0],
        source: {
          taskId: 'task-1',
          submissionId: 'submission-1',
          artifactId: 'artifact-1',
          artifactSha256Hash: 'not-a-hash',
          artifactKeccak256Hash: KECCAK256,
          artifactMimeType: 'text/html',
          artifactSizeBytes: 1,
        },
        artifactUrl: null,
        artifactUrlExpiresAt: null,
      })
    ).toThrow();
  });

  // Verifies: ADR-0089
  it('accepts only explicit reversible vote values and canonical vote-state DTOs', () => {
    expect(GameVoteInputSchema.parse({ gameId: '  game-1 ', value: 1 })).toEqual({
      gameId: 'game-1',
      value: 1,
    });
    expect(GameVoteStateInputSchema.parse({ gameId: 'game-1' })).toEqual({ gameId: 'game-1' });
    expect(() => GameVoteInputSchema.parse({ gameId: 'game-1', value: 0 })).toThrow();

    expect(
      GameVoteResponseSchema.parse({
        gameId: 'game-1',
        upvoteCount: 7,
        downvoteCount: 2,
        netVotes: 5,
        selectedVote: -1,
      })
    ).toEqual({
      gameId: 'game-1',
      upvoteCount: 7,
      downvoteCount: 2,
      netVotes: 5,
      selectedVote: -1,
    });
  });
});
