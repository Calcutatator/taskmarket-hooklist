// Verifies: ADR-0089 and ADR-0090
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  artifacts,
  gameVoteRateLimits,
  gameVotes,
  games,
  submissions,
  tasks,
} from '../../src/db/schema';
import {
  GAME_VOTE_RATE_LIMIT_PER_USER,
  GameVoteRateLimitedError,
  getGameVoteState,
  setGameVote,
} from '../../src/services/game-votes';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('game_votes', { maxConnections: 24 });
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const artifactIds: string[] = [];
const gameIds: string[] = [];
const submissionIds: string[] = [];
const taskIds: string[] = [];

const SHA256 = 'a'.repeat(64);
const KECCAK256 = `0x${'b'.repeat(64)}`;

async function seedPublishedGame() {
  const suffix = randomUUID();
  const taskId = `game-vote-task-${suffix}`;
  const submissionId = `game-vote-submission-${suffix}`;
  const artifactId = `game-vote-artifact-${suffix}`;
  const gameId = `game-vote-${suffix}`;

  taskIds.push(taskId);
  submissionIds.push(submissionId);
  artifactIds.push(artifactId);
  gameIds.push(gameId);

  await database!.insert(tasks).values({
    description: 'Build an arcade game with a reversible vote control.',
    escrowTxHash: `escrow-${suffix}`,
    expiryTime: new Date('2030-01-01T00:00:00.000Z'),
    id: taskId,
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: 'requester-key',
    reward: '1000000',
    status: 'completed',
    tags: ['games'],
  });
  await database!.insert(submissions).values({
    fileUrl: `s3://private-bucket/submissions/${suffix}/index.html`,
    id: submissionId,
    signature: 'signature',
    taskId,
    workerAddress: '0x2222222222222222222222222222222222222222',
  });
  await database!.insert(artifacts).values({
    displayOrder: 0,
    fileName: 'index.html',
    id: artifactId,
    keccak256Hash: KECCAK256,
    mediaKind: 'text',
    mimeType: 'text/html',
    role: 'final',
    sha256Hash: SHA256,
    sizeBytes: 1_024,
    storageUri: `s3://private-bucket/${artifactId}.html`,
    submissionId,
    taskId,
  });
  await database!.insert(games).values({
    artifactId,
    artifactKeccak256Hash: KECCAK256,
    artifactMimeType: 'text/html',
    artifactSha256Hash: SHA256,
    artifactSizeBytes: 1_024,
    id: gameId,
    publishedAt: new Date('2026-08-16T00:00:00.000Z'),
    slug: `vote-game-${suffix}`,
    status: 'published',
    submissionId,
    tags: ['arcade'],
    taskId,
    title: 'Vote Game',
  });

  return gameId;
}

describeWithDatabase('Slap-Chop Game votes', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    await database!.delete(gameVoteRateLimits);
    if (gameIds.length > 0) {
      await database!.delete(gameVotes).where(inArray(gameVotes.gameId, gameIds));
      await database!.delete(games).where(inArray(games.id, gameIds.splice(0)));
    }
    if (artifactIds.length > 0) {
      await database!.delete(artifacts).where(inArray(artifacts.id, artifactIds.splice(0)));
    }
    if (submissionIds.length > 0) {
      await database!.delete(submissions).where(inArray(submissions.id, submissionIds.splice(0)));
    }
    if (taskIds.length > 0) {
      await database!.delete(tasks).where(inArray(tasks.id, taskIds.splice(0)));
    }
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('adds, removes, replaces, and canonically reconciles one Privy user vote', async () => {
    const gameId = await seedPublishedGame();
    const voter = { clientAddress: '203.0.113.10', privyUserId: 'did:privy:voter-1' };

    await expect(setGameVote(database!, { ...voter, gameId, value: 1 })).resolves.toMatchObject({
      downvoteCount: 0,
      netVotes: 1,
      selectedVote: 1,
      upvoteCount: 1,
    });
    await expect(setGameVote(database!, { ...voter, gameId, value: 1 })).resolves.toMatchObject({
      downvoteCount: 0,
      netVotes: 0,
      selectedVote: null,
      upvoteCount: 0,
    });
    await expect(setGameVote(database!, { ...voter, gameId, value: -1 })).resolves.toMatchObject({
      downvoteCount: 1,
      netVotes: -1,
      selectedVote: -1,
      upvoteCount: 0,
    });
    await expect(setGameVote(database!, { ...voter, gameId, value: 1 })).resolves.toMatchObject({
      downvoteCount: 0,
      netVotes: 1,
      selectedVote: 1,
      upvoteCount: 1,
    });

    // Deliberately corrupt the cached totals. The next transactional write must derive both
    // returned state and cache from canonical rows rather than trusting stale cache values.
    await database!
      .update(games)
      .set({ downvoteCount: 77, upvoteCount: 99 })
      .where(eq(games.id, gameId));

    await expect(setGameVote(database!, { ...voter, gameId, value: 1 })).resolves.toEqual({
      downvoteCount: 0,
      gameId,
      netVotes: 0,
      selectedVote: null,
      upvoteCount: 0,
    });
    await expect(getGameVoteState(database!, { gameId, privyUserId: voter.privyUserId })).resolves.toEqual({
      downvoteCount: 0,
      gameId,
      netVotes: 0,
      selectedVote: null,
      upvoteCount: 0,
    });
  });

  it('serializes concurrent voters and keeps cached counts equal to canonical rows', async () => {
    const gameId = await seedPublishedGame();
    const voters = Array.from({ length: 12 }, (_, index) => ({
      clientAddress: `203.0.113.${index + 10}`,
      gameId,
      privyUserId: `did:privy:concurrent-${index}`,
      value: 1 as const,
    }));

    const results = await Promise.all(voters.map((vote) => setGameVote(database!, vote)));
    expect(results).toHaveLength(voters.length);

    const [cached] = await database!
      .select({ downvoteCount: games.downvoteCount, upvoteCount: games.upvoteCount })
      .from(games)
      .where(eq(games.id, gameId));
    const canonical = await database!
      .select({ value: gameVotes.value })
      .from(gameVotes)
      .where(eq(gameVotes.gameId, gameId));

    expect(canonical).toHaveLength(voters.length);
    expect(cached).toEqual({ downvoteCount: 0, upvoteCount: voters.length });
    expect(canonical.filter((vote) => vote.value === 1)).toHaveLength(voters.length);
  });

  it('enforces the verified-user window before a new vote row can be written', async () => {
    const gameId = await seedPublishedGame();
    const voter = { clientAddress: '203.0.113.30', gameId, privyUserId: 'did:privy:limited-user' };

    for (let attempt = 0; attempt < GAME_VOTE_RATE_LIMIT_PER_USER; attempt += 1) {
      await setGameVote(database!, { ...voter, value: 1 });
    }

    await expect(setGameVote(database!, { ...voter, value: 1 })).rejects.toBeInstanceOf(
      GameVoteRateLimitedError
    );
    await expect(getGameVoteState(database!, { gameId, privyUserId: voter.privyUserId })).resolves.toEqual({
      downvoteCount: 0,
      gameId,
      netVotes: 0,
      selectedVote: null,
      upvoteCount: 0,
    });
  });
});
