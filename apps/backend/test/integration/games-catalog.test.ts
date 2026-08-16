// Verifies: ADR-0087 and ADR-0090
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { getGameDeliveryUrlMock, logSlapChopArtifactDeliveryFailure, logSlapChopCatalogRead } =
  vi.hoisted(() => ({
    getGameDeliveryUrlMock: vi.fn(),
    logSlapChopArtifactDeliveryFailure: vi.fn(),
    logSlapChopCatalogRead: vi.fn(),
  }));

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({ SLAP_CHOP_RANKING_MODE: 'hot' }),
  };
});

vi.mock('../../src/services/game-delivery', () => ({
  getGameDeliveryUrl: getGameDeliveryUrlMock,
}));

vi.mock('../../src/lib/slap-chop-observability', () => ({
  logSlapChopArtifactDeliveryFailure,
  logSlapChopCatalogRead,
  slapChopDurationMs: vi.fn().mockReturnValue(7),
}));

import { artifacts, games, submissions, tasks } from '../../src/db/schema';
import { gamesRouter } from '../../src/routers/games.router';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('games_catalog');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const gameIds: string[] = [];
const artifactIds: string[] = [];
const submissionIds: string[] = [];
const taskIds: string[] = [];

const SHA256 = 'a'.repeat(64);
const KECCAK256 = `0x${'b'.repeat(64)}`;

function caller() {
  return gamesRouter.createCaller({
    db: database!,
    req: {} as never,
    res: { locals: {} } as never,
    caller: undefined,
    idempotencyKey: undefined,
    taskAccessGrant: undefined,
  });
}

async function seedCatalog() {
  const suffix = randomUUID();
  const taskId = `game-task-${suffix}`;
  const submissionId = `game-submission-${suffix}`;
  const strongArtifactId = `game-artifact-strong-${suffix}`;
  const newerArtifactId = `game-artifact-newer-${suffix}`;
  const hiddenArtifactId = `game-artifact-hidden-${suffix}`;
  const strongGameId = `game-strong-${suffix}`;
  const newerGameId = `game-newer-${suffix}`;
  const hiddenGameId = `game-hidden-${suffix}`;
  const draftGameId = `game-draft-${suffix}`;
  const epoch = new Date('2026-01-01T00:00:00.000Z');
  const oneWeekLater = new Date('2026-01-08T00:00:00.000Z');

  taskIds.push(taskId);
  submissionIds.push(submissionId);
  artifactIds.push(strongArtifactId, newerArtifactId, hiddenArtifactId);
  gameIds.push(strongGameId, newerGameId, hiddenGameId, draftGameId);

  await database!.insert(tasks).values({
    id: taskId,
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: 'requester-key',
    description: 'Build an orbital pinball game with a bright comet trail.',
    reward: '1000000',
    escrowTxHash: `escrow-${suffix}`,
    expiryTime: new Date('2030-01-01T00:00:00.000Z'),
    status: 'completed',
    tags: ['games'],
  });
  await database!.insert(submissions).values({
    id: submissionId,
    taskId,
    workerAddress: '0x2222222222222222222222222222222222222222',
    fileUrl: `s3://private-bucket/submissions/${suffix}/index.html`,
    signature: 'signature',
  });
  await database!.insert(artifacts).values([
    strongArtifactId,
    newerArtifactId,
    hiddenArtifactId,
  ].map((id, displayOrder) => ({
    id,
    taskId,
    submissionId,
    role: 'final',
    fileName: `${id}.html`,
    mimeType: 'text/html',
    mediaKind: 'text',
    storageUri: `s3://private-bucket/${id}.html`,
    sizeBytes: 1_024,
    sha256Hash: SHA256,
    keccak256Hash: KECCAK256,
    displayOrder,
  })));

  const baseGame = {
    taskId,
    submissionId,
    artifactSha256Hash: SHA256,
    artifactKeccak256Hash: KECCAK256,
    artifactMimeType: 'text/html',
    artifactSizeBytes: 1_024,
    coverSource: 'catalog_asset' as const,
    coverStorageUri: `s3://private-bucket/covers/${suffix}.png`,
    coverAltText: 'A bright comet trail over a pinball table.',
    tags: ['arcade', 'pinball'],
    creatorName: 'Rin',
  };

  await database!.insert(games).values([
    {
      ...baseGame,
      id: strongGameId,
      slug: `orbital-pinball-${suffix}`,
      title: 'Orbital Pinball',
      artifactId: strongArtifactId,
      status: 'published',
      upvoteCount: 10,
      downvoteCount: 0,
      publishedAt: epoch,
    },
    {
      ...baseGame,
      id: newerGameId,
      slug: `comet-drift-${suffix}`,
      title: 'Comet Drift',
      artifactId: newerArtifactId,
      status: 'published',
      upvoteCount: 0,
      downvoteCount: 0,
      publishedAt: oneWeekLater,
    },
    {
      ...baseGame,
      id: hiddenGameId,
      slug: `hidden-game-${suffix}`,
      title: 'Hidden Game',
      artifactId: hiddenArtifactId,
      status: 'hidden',
      upvoteCount: 100,
      downvoteCount: 0,
      publishedAt: oneWeekLater,
      hiddenAt: oneWeekLater,
    },
    {
      ...baseGame,
      id: draftGameId,
      slug: `draft-game-${suffix}`,
      title: 'Draft Game',
      artifactId: hiddenArtifactId,
      status: 'draft',
      upvoteCount: 100,
      downvoteCount: 0,
    },
  ]);

  return {
    hiddenSlug: `hidden-game-${suffix}`,
    newerId: newerGameId,
    strongArtifactId,
    strongId: strongGameId,
    strongSlug: `orbital-pinball-${suffix}`,
  };
}

describeWithDatabase('Slap-Chop Games public catalog', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (gameIds.length > 0) await database!.delete(games).where(inArray(games.id, gameIds.splice(0)));
    if (artifactIds.length > 0) {
      await database!.delete(artifacts).where(inArray(artifacts.id, artifactIds.splice(0)));
    }
    if (submissionIds.length > 0) {
      await database!.delete(submissions).where(inArray(submissions.id, submissionIds.splice(0)));
    }
    if (taskIds.length > 0) await database!.delete(tasks).where(inArray(tasks.id, taskIds.splice(0)));
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('lists only published games in deterministic Hot-score pages and searches curated task metadata', async () => {
    getGameDeliveryUrlMock.mockResolvedValue({
      url: 'https://storage.example.test/short-lived-cover',
      expiresAt: '2026-08-16T00:05:00.000Z',
    });
    const seeded = await seedCatalog();

    const firstPage = await caller().list({ limit: 1, query: '  PINBALL ' });
    expect(firstPage.games.map((game) => game.id)).toEqual([seeded.strongId]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.games[0]).not.toHaveProperty('coverStorageUri');
    expect(firstPage.games[0]?.coverUrl).toBe('https://storage.example.test/short-lived-cover');
    expect(logSlapChopCatalogRead).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactDeliveryUnavailableCount: 0,
        hasCursor: false,
        hasSearchQuery: true,
        operation: 'list',
        outcome: 'success',
        resultCount: 1,
      })
    );

    const taskMetadataSearch = await caller().list({ limit: 48, query: '  COMET TRAIL ' });
    expect(taskMetadataSearch.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seeded.strongId,
          taskDescription: 'Build an orbital pinball game with a bright comet trail.',
        }),
      ])
    );

    const secondPage = await caller().list({
      limit: 1,
      query: 'pinball',
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.games.map((game) => game.id)).toEqual([seeded.newerId]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('returns one published exact artifact pin with a refreshable delivery URL and hides drafts', async () => {
    getGameDeliveryUrlMock.mockResolvedValue({
      url: 'https://storage.example.test/short-lived-object',
      expiresAt: '2026-08-16T00:05:00.000Z',
    });
    const seeded = await seedCatalog();

    const game = await caller().get({ slug: seeded.strongSlug });
    expect(game).toMatchObject({
      id: seeded.strongId,
      artifactUrl: 'https://storage.example.test/short-lived-object',
      artifactUrlExpiresAt: '2026-08-16T00:05:00.000Z',
      taskDescription: 'Build an orbital pinball game with a bright comet trail.',
      source: {
        artifactSha256Hash: SHA256,
        artifactKeccak256Hash: KECCAK256,
      },
    });
    expect(game).not.toHaveProperty('selectedArtifactStorageUri');
    expect(game).not.toHaveProperty('coverStorageUri');
    expect(logSlapChopCatalogRead).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'get', outcome: 'success', resultCount: 1 })
    );
    await expect(caller().get({ slug: seeded.hiddenSlug })).resolves.toBeNull();
  });

  it('fails closed when the mutable artifact row no longer matches the publication pin', async () => {
    getGameDeliveryUrlMock.mockResolvedValue({
      url: 'https://storage.example.test/short-lived-object',
      expiresAt: '2026-08-16T00:05:00.000Z',
    });
    const seeded = await seedCatalog();
    await database!
      .update(artifacts)
      .set({ sha256Hash: 'c'.repeat(64) })
      .where(eq(artifacts.id, seeded.strongArtifactId));

    const game = await caller().get({ slug: seeded.strongSlug });
    expect(game).toMatchObject({
      id: seeded.strongId,
      artifactUrl: null,
      artifactUrlExpiresAt: null,
      source: { artifactSha256Hash: SHA256 },
    });
    expect(logSlapChopArtifactDeliveryFailure).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'catalog_artifact', reason: 'source_pin_mismatch' })
    );
  });
});
