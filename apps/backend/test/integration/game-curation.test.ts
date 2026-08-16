// Verifies: ADR-0087 and ADR-0088
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GameCurationResolveTaskInputSchema, type GameCurationUpsertInput } from '@taskmarket/shared';

import {
  artifacts,
  gameCurationEvents,
  games,
  submissions,
  taskAwards,
  tasks,
} from '../../src/db/schema';
import { sha256Hex } from '../../src/lib/hash';
import {
  type GameCurationDependencies,
  hideGameCuration,
  publishGameCuration,
  resolveTaskForGameCuration,
  upsertGameCuration,
} from '../../src/services/game-curation';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('game_curation');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const gameIds: string[] = [];
const artifactIds: string[] = [];
const submissionIds: string[] = [];
const taskIds: string[] = [];

const ACTOR_PRIVY_USER_ID = 'did:privy:curator_1';
const KECCAK256 = `0x${'b'.repeat(64)}`;
const NOW = new Date('2026-08-16T00:00:00.000Z');
let nextAwardBlockNumber = 1n;

function squarePng(width = 64, height = width): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function deliveryDependencies(objects: Map<string, Buffer>): GameCurationDependencies {
  let id = 0;
  const storageUriForKey = (key: string) => `s3://catalog-bucket/${key}`;

  return {
    fetch: async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const storageUri = decodeURIComponent(new URL(url).pathname.slice(1));
      const bytes = objects.get(storageUri);
      return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 });
    },
    getDeliveryUrl: async (storageUri) =>
      storageUri && objects.has(storageUri)
        ? {
            expiresAt: '2026-08-16T00:05:00.000Z',
            url: `https://delivery.example.test/${encodeURIComponent(storageUri)}`,
          }
        : null,
    makeId: () => `curation-event-${id++}`,
    now: () => NOW,
    storage: {
      getPresignedUrl: async (key) => `https://delivery.example.test/${encodeURIComponent(key)}`,
      headObject: async (key) => {
        const bytes = objects.get(storageUriForKey(key));
        return bytes ? { contentLength: bytes.length } : null;
      },
      storageUriForKey,
      upload: async (key, data) => {
        const storageUri = storageUriForKey(key);
        objects.set(storageUri, Buffer.from(data));
        return storageUri;
      },
    },
  };
}

async function seedCuratableTask() {
  const suffix = randomUUID();
  const awardBlockNumber = nextAwardBlockNumber;
  nextAwardBlockNumber += 1n;
  const taskId = `curation-task-${suffix}`;
  const acceptedSubmissionId = `accepted-submission-${suffix}`;
  const rejectedSubmissionId = `rejected-submission-${suffix}`;
  const playableArtifactId = `playable-artifact-${suffix}`;
  const wrongRoleArtifactId = `wrong-role-artifact-${suffix}`;
  const wrongMimeArtifactId = `wrong-mime-artifact-${suffix}`;
  const oversizedArtifactId = `oversized-artifact-${suffix}`;
  const rejectedArtifactId = `rejected-artifact-${suffix}`;
  const sourceUri = `s3://taskmarket-private/${suffix}/game.html`;
  const sourceBytes = Buffer.from('<!doctype html><title>Arcade</title>');
  const sourceSha256 = sha256Hex(sourceBytes);
  const objects = new Map<string, Buffer>([[sourceUri, sourceBytes]]);

  taskIds.push(taskId);
  submissionIds.push(acceptedSubmissionId, rejectedSubmissionId);
  artifactIds.push(
    playableArtifactId,
    wrongRoleArtifactId,
    wrongMimeArtifactId,
    oversizedArtifactId,
    rejectedArtifactId
  );

  await database!.insert(tasks).values({
    id: taskId,
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: 'requester-public-key',
    description: 'Build a compact arcade game.',
    reward: '1000000',
    escrowTxHash: `curation-escrow-${suffix}`,
    expiryTime: new Date('2030-01-01T00:00:00.000Z'),
    status: 'completed',
    tags: ['arcade'],
    submissionVisibility: 'public',
    taskVisibility: 'public',
  });
  await database!.insert(submissions).values([
    {
      id: acceptedSubmissionId,
      taskId,
      workerAddress: '0x2222222222222222222222222222222222222222',
      fileUrl: sourceUri,
      signature: 'accepted-signature',
    },
    {
      id: rejectedSubmissionId,
      taskId,
      workerAddress: '0x3333333333333333333333333333333333333333',
      fileUrl: `s3://taskmarket-private/${suffix}/rejected.html`,
      rejectedAt: NOW,
      signature: 'rejected-signature',
    },
  ]);
  await database!.insert(taskAwards).values({
    taskId,
    workerAddress: '0x2222222222222222222222222222222222222222',
    rank: 1,
    workerPayment: '950000',
    platformFee: '50000',
    settlementTxHash: `curation-settlement-${suffix}`,
    chainId: 8453,
    blockNumber: awardBlockNumber,
    logIndex: 1,
    settledAt: NOW,
  });
  await database!.insert(artifacts).values([
    {
      id: playableArtifactId,
      taskId,
      submissionId: acceptedSubmissionId,
      role: 'final',
      fileName: 'index.html',
      mimeType: 'text/html',
      mediaKind: 'text',
      storageUri: sourceUri,
      sizeBytes: sourceBytes.length,
      sha256Hash: sourceSha256,
      keccak256Hash: KECCAK256,
      displayOrder: 0,
    },
    {
      id: wrongRoleArtifactId,
      taskId,
      submissionId: acceptedSubmissionId,
      role: 'attachment',
      fileName: 'attachment.html',
      mimeType: 'text/html',
      mediaKind: 'text',
      storageUri: `s3://taskmarket-private/${suffix}/attachment.html`,
      sizeBytes: sourceBytes.length,
      sha256Hash: sourceSha256,
      keccak256Hash: KECCAK256,
      displayOrder: 1,
    },
    {
      id: wrongMimeArtifactId,
      taskId,
      submissionId: acceptedSubmissionId,
      role: 'final',
      fileName: 'game.txt',
      mimeType: 'text/plain',
      mediaKind: 'text',
      storageUri: `s3://taskmarket-private/${suffix}/game.txt`,
      sizeBytes: sourceBytes.length,
      sha256Hash: sourceSha256,
      keccak256Hash: KECCAK256,
      displayOrder: 2,
    },
    {
      id: oversizedArtifactId,
      taskId,
      submissionId: acceptedSubmissionId,
      role: 'final',
      fileName: 'large.html',
      mimeType: 'text/html',
      mediaKind: 'text',
      storageUri: `s3://taskmarket-private/${suffix}/large.html`,
      sizeBytes: 5 * 1024 * 1024 + 1,
      sha256Hash: sourceSha256,
      keccak256Hash: KECCAK256,
      displayOrder: 3,
    },
    {
      id: rejectedArtifactId,
      taskId,
      submissionId: rejectedSubmissionId,
      role: 'final',
      fileName: 'rejected.html',
      mimeType: 'text/html',
      mediaKind: 'text',
      storageUri: `s3://taskmarket-private/${suffix}/rejected.html`,
      sizeBytes: sourceBytes.length,
      sha256Hash: sourceSha256,
      keccak256Hash: KECCAK256,
      displayOrder: 0,
    },
  ]);

  return {
    acceptedSubmissionId,
    objects,
    playableArtifactId,
    rejectedArtifactId,
    rejectedSubmissionId,
    sourceUri,
    sourceSha256,
    taskId,
    wrongMimeArtifactId,
    wrongRoleArtifactId,
    oversizedArtifactId,
  };
}

function upsertInput(
  seed: Awaited<ReturnType<typeof seedCuratableTask>>,
  overrides: Partial<GameCurationUpsertInput> = {}
): GameCurationUpsertInput {
  return {
    artifactId: seed.playableArtifactId,
    cover: {
      dataBase64: squarePng().toString('base64'),
      mimeType: 'image/png',
      source: 'catalog_asset',
    },
    creatorName: 'Arcade Builder',
    description: 'A verified one-screen arcade game.',
    previewed: false,
    slug: `arcade-${seed.taskId.slice(-12)}`,
    submissionId: seed.acceptedSubmissionId,
    tags: ['arcade'],
    taskId: seed.taskId,
    title: 'Verified Arcade',
    ...overrides,
  };
}

describeWithDatabase('Slap-Chop game curation workflow', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    if (gameIds.length > 0) {
      await database!
        .delete(gameCurationEvents)
        .where(inArray(gameCurationEvents.gameId, gameIds));
      await database!.delete(games).where(inArray(games.id, gameIds.splice(0)));
    }
    if (artifactIds.length > 0) {
      await database!.delete(artifacts).where(inArray(artifacts.id, artifactIds.splice(0)));
    }
    if (taskIds.length > 0) {
      await database!.delete(taskAwards).where(inArray(taskAwards.taskId, taskIds));
    }
    if (submissionIds.length > 0) {
      await database!.delete(submissions).where(inArray(submissions.id, submissionIds.splice(0)));
    }
    if (taskIds.length > 0) await database!.delete(tasks).where(inArray(tasks.id, taskIds.splice(0)));
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('resolves only accepted playable public artifacts and audits draft, publish, hide, and re-publish', async () => {
    const seed = await seedCuratableTask();
    const dependencies = deliveryDependencies(seed.objects);
    const reference = GameCurationResolveTaskInputSchema.parse({
      reference: `https://taskmarket.dev/tasks/${encodeURIComponent(seed.taskId)}`,
    }).reference;

    const resolved = await resolveTaskForGameCuration(database!, reference, dependencies);
    expect(resolved).toMatchObject({ eligible: true, eligibilityReason: null });
    expect(resolved.submissions).toHaveLength(1);
    expect(resolved.submissions[0]).toMatchObject({ id: seed.acceptedSubmissionId });
    expect(resolved.submissions[0]?.artifacts.map((artifact) => artifact.id)).toEqual([
      seed.playableArtifactId,
    ]);
    expect(JSON.stringify(resolved)).not.toContain('s3://');

    for (const artifactId of [
      seed.wrongRoleArtifactId,
      seed.wrongMimeArtifactId,
      seed.oversizedArtifactId,
    ]) {
      await expect(
        upsertGameCuration(
          database!,
          ACTOR_PRIVY_USER_ID,
          upsertInput(seed, { artifactId }),
          dependencies
        )
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    }
    await expect(
      upsertGameCuration(
        database!,
        ACTOR_PRIVY_USER_ID,
        upsertInput(seed, {
          artifactId: seed.rejectedArtifactId,
          submissionId: seed.rejectedSubmissionId,
        }),
        dependencies
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const draft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed),
      dependencies
    );
    gameIds.push(draft.id);
    expect(draft).toMatchObject({
      artifactId: seed.playableArtifactId,
      artifactSha256Hash: seed.sourceSha256,
      coverSource: 'catalog_asset',
      previewedAt: null,
      status: 'draft',
    });
    expect(draft.coverStorageUri).toMatch(/^s3:\/\/catalog-bucket\/slap-chop-games\/covers\/sha256\//);

    await expect(
      publishGameCuration(database!, ACTOR_PRIVY_USER_ID, draft.id, dependencies)
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const previewedDraft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed, { cover: undefined, gameId: draft.id, previewed: true }),
      dependencies
    );
    const published = await publishGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      previewedDraft.id,
      dependencies
    );
    expect(published).toMatchObject({ hiddenAt: null, status: 'published' });
    await expect(
      upsertGameCuration(
        database!,
        ACTOR_PRIVY_USER_ID,
        upsertInput(seed, { gameId: published.id }),
        dependencies
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const hidden = await hideGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      published.id,
      dependencies
    );
    expect(hidden).toMatchObject({ status: 'hidden' });
    const republished = await publishGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      hidden.id,
      dependencies
    );
    expect(republished).toMatchObject({ hiddenAt: null, status: 'published' });

    const events = await database!
      .select()
      .from(gameCurationEvents)
      .where(eq(gameCurationEvents.gameId, draft.id));
    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.action === 'draft_saved')).toHaveLength(2);
    expect(events.filter((event) => event.action === 'published')).toHaveLength(2);
    expect(events.filter((event) => event.action === 'hidden')).toHaveLength(1);
    expect(events.every((event) => event.actorPrivyUserId === ACTOR_PRIVY_USER_ID)).toBe(true);
    expect(events.every((event) => event.afterMetadata !== null)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('s3://');
  });

  it('reports a duplicate game slug as a deterministic conflict', async () => {
    const firstSeed = await seedCuratableTask();
    const secondSeed = await seedCuratableTask();
    const dependencies = deliveryDependencies(
      new Map([...firstSeed.objects, ...secondSeed.objects])
    );
    const firstDraft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(firstSeed),
      dependencies
    );
    gameIds.push(firstDraft.id);

    await expect(
      upsertGameCuration(
        database!,
        ACTOR_PRIVY_USER_ID,
        upsertInput(secondSeed, { slug: firstDraft.slug }),
        dependencies
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'A game already uses this slug',
    });
  });

  it('rejects ambiguous submissions from an awarded worker instead of guessing their provenance', async () => {
    const seed = await seedCuratableTask();
    const dependencies = deliveryDependencies(seed.objects);
    const ambiguousSubmissionId = `ambiguous-submission-${randomUUID()}`;
    const ambiguousArtifactId = `ambiguous-artifact-${randomUUID()}`;
    const ambiguousSourceUri = `s3://taskmarket-private/${randomUUID()}/ambiguous.html`;
    const ambiguousSourceBytes = Buffer.from('<!doctype html><title>Ambiguous arcade</title>');
    submissionIds.push(ambiguousSubmissionId);
    artifactIds.push(ambiguousArtifactId);
    seed.objects.set(ambiguousSourceUri, ambiguousSourceBytes);

    await database!.insert(submissions).values({
      fileUrl: ambiguousSourceUri,
      id: ambiguousSubmissionId,
      signature: 'ambiguous-signature',
      taskId: seed.taskId,
      workerAddress: '0x2222222222222222222222222222222222222222',
    });
    await database!.insert(artifacts).values({
      displayOrder: 0,
      fileName: 'ambiguous.html',
      id: ambiguousArtifactId,
      keccak256Hash: KECCAK256,
      mediaKind: 'text',
      mimeType: 'text/html',
      role: 'final',
      sha256Hash: sha256Hex(ambiguousSourceBytes),
      sizeBytes: ambiguousSourceBytes.length,
      storageUri: ambiguousSourceUri,
      submissionId: ambiguousSubmissionId,
      taskId: seed.taskId,
    });

    await expect(resolveTaskForGameCuration(database!, seed.taskId, dependencies)).resolves.toMatchObject({
      eligibilityReason: expect.stringContaining('exactly one active submission'),
      eligible: false,
      submissions: [],
    });
    await expect(
      upsertGameCuration(database!, ACTOR_PRIVY_USER_ID, upsertInput(seed), dependencies)
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('exactly one active submission'),
    });
    await expect(
      upsertGameCuration(
        database!,
        ACTOR_PRIVY_USER_ID,
        upsertInput(seed, {
          artifactId: ambiguousArtifactId,
          submissionId: ambiguousSubmissionId,
        }),
        dependencies
      )
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('exactly one active submission'),
    });
  });

  it('rejects a stale draft save after a concurrent revision', async () => {
    const seed = await seedCuratableTask();
    const dependencies = deliveryDependencies(seed.objects);
    const draft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed),
      dependencies
    );
    gameIds.push(draft.id);

    const baseStorage = dependencies.storage!;
    let releaseCoverResolution: () => void = () => undefined;
    const coverResolutionReleased = new Promise<void>((resolve) => {
      releaseCoverResolution = resolve;
    });
    let markCoverResolutionStarted: () => void = () => undefined;
    const coverResolutionStarted = new Promise<void>((resolve) => {
      markCoverResolutionStarted = resolve;
    });
    let pauseOnce = true;
    dependencies.storage = {
      ...baseStorage,
      headObject: async (key) => {
        if (pauseOnce) {
          pauseOnce = false;
          markCoverResolutionStarted();
          await coverResolutionReleased;
        }
        return baseStorage.headObject(key);
      },
    };

    const staleSave = upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed, {
        cover: {
          dataBase64: squarePng().toString('base64'),
          mimeType: 'image/png',
          source: 'catalog_asset',
        },
        gameId: draft.id,
        title: 'Stale curator save',
      }),
      dependencies
    );
    await coverResolutionStarted;

    await database!
      .update(games)
      .set({ title: 'Concurrent curator save', updatedAt: new Date('2026-08-16T00:00:01.000Z') })
      .where(eq(games.id, draft.id));
    releaseCoverResolution();

    await expect(staleSave).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Game changed before it could be saved',
    });
    const [saved] = await database!.select().from(games).where(eq(games.id, draft.id));
    expect(saved).toMatchObject({ title: 'Concurrent curator save' });
  });

  it('rejects a stale publish after a concurrent draft revision', async () => {
    const seed = await seedCuratableTask();
    const dependencies = deliveryDependencies(seed.objects);
    const draft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed),
      dependencies
    );
    gameIds.push(draft.id);
    const reviewedDraft = await upsertGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      upsertInput(seed, { cover: undefined, gameId: draft.id, previewed: true }),
      dependencies
    );

    const baseGetDeliveryUrl = dependencies.getDeliveryUrl!;
    let releaseSourceDelivery: () => void = () => undefined;
    const sourceDeliveryReleased = new Promise<void>((resolve) => {
      releaseSourceDelivery = resolve;
    });
    let markSourceDeliveryStarted: () => void = () => undefined;
    const sourceDeliveryStarted = new Promise<void>((resolve) => {
      markSourceDeliveryStarted = resolve;
    });
    let pauseSourceDelivery = true;
    dependencies.getDeliveryUrl = async (storageUri) => {
      if (pauseSourceDelivery && storageUri === seed.sourceUri) {
        pauseSourceDelivery = false;
        markSourceDeliveryStarted();
        await sourceDeliveryReleased;
      }
      return baseGetDeliveryUrl(storageUri);
    };

    const stalePublish = publishGameCuration(
      database!,
      ACTOR_PRIVY_USER_ID,
      reviewedDraft.id,
      dependencies
    );
    await sourceDeliveryStarted;

    await database!
      .update(games)
      .set({ title: 'Concurrent draft revision', updatedAt: new Date('2026-08-16T00:00:02.000Z') })
      .where(eq(games.id, reviewedDraft.id));
    releaseSourceDelivery();

    await expect(stalePublish).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Game changed before it could be published',
    });
    const [saved] = await database!.select().from(games).where(eq(games.id, reviewedDraft.id));
    expect(saved).toMatchObject({ status: 'draft', title: 'Concurrent draft revision' });
  });

  it('does not disclose non-public task metadata and fails closed when a task is unresolved or unavailable', async () => {
    const seed = await seedCuratableTask();
    const dependencies = deliveryDependencies(seed.objects);

    for (const taskVisibility of ['private', 'unlisted'] as const) {
      await database!
        .update(tasks)
        .set({ taskVisibility })
        .where(eq(tasks.id, seed.taskId));
      await expect(resolveTaskForGameCuration(database!, seed.taskId, dependencies)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
      await expect(
        upsertGameCuration(database!, ACTOR_PRIVY_USER_ID, upsertInput(seed), dependencies)
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    await database!
      .update(tasks)
      .set({ status: 'open', taskVisibility: 'public' })
      .where(eq(tasks.id, seed.taskId));
    await expect(resolveTaskForGameCuration(database!, seed.taskId, dependencies)).resolves.toMatchObject({
      eligible: false,
      submissions: [],
    });

    await database!
      .update(tasks)
      .set({ status: 'completed' })
      .where(eq(tasks.id, seed.taskId));
    seed.objects.delete(seed.sourceUri);
    await expect(resolveTaskForGameCuration(database!, seed.taskId, dependencies)).resolves.toMatchObject({
      eligible: false,
      submissions: [],
    });
  });
});
