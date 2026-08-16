import { randomUUID } from 'node:crypto';
import {
  type GameCurationCoverInput,
  type GameCurationGame,
  type GameCurationResolvedTask,
  type GameCurationUpsertInput,
  MAX_GAME_COVER_BYTES,
  MAX_GAME_COVER_DIMENSION,
} from '@taskmarket/shared';
import {
  getInteractiveHtmlEligibility,
  MAX_INTERACTIVE_HTML_BYTES,
} from '@taskmarket/html-sandbox';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import {
  artifacts,
  gameCurationEvents,
  games,
  submissions,
  taskAwards,
  tasks,
  type Artifact,
  type Game,
  type Task,
} from '../db/schema';
import { sha256Hex } from '../lib/hash';
import { getStorageBackend, type StorageBackend } from '../lib/storage';
import { getGameDeliveryUrl, type GameDeliveryUrl } from './game-delivery';

type Database = Pick<typeof DbType, 'insert' | 'select' | 'transaction' | 'update'>;
type CurationStorage = Pick<
  StorageBackend,
  'getPresignedUrl' | 'headObject' | 'storageUriForKey' | 'upload'
>;

type EligibleSource = Pick<
  Artifact,
  | 'fileName'
  | 'id'
  | 'keccak256Hash'
  | 'mimeType'
  | 'sha256Hash'
  | 'sizeBytes'
  | 'storageUri'
  | 'submissionId'
  | 'taskId'
>;

type PersistedCover = {
  artifactId: string | null;
  height: number;
  mimeType: string;
  sha256Hash: string;
  source: 'artifact' | 'catalog_asset';
  storageUri: string;
  width: number;
};

export type GameCurationDependencies = {
  fetch?: typeof globalThis.fetch;
  getDeliveryUrl?: (storageUri: string | null) => Promise<GameDeliveryUrl | null>;
  makeId?: () => string;
  now?: () => Date;
  storage?: CurationStorage;
};

export class GameCurationError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND' | 'PRECONDITION_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'GameCurationError';
  }
}

function isPostgresUniqueViolation(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object') return false;
  if (seen.has(error)) return false;
  seen.add(error);

  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isPostgresUniqueViolation(error.cause, seen);
}

const PLAYABLE_ARTIFACT_ROLES = new Set(['final', 'preview']);
const SUPPORTED_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function nowFor(options: GameCurationDependencies): Date {
  return options.now?.() ?? new Date();
}

function idFor(options: GameCurationDependencies): string {
  return options.makeId?.() ?? randomUUID();
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function taskEligibilityReason(
  task: Pick<Task, 'status' | 'submissionVisibility' | 'taskVisibility'>
): string | null {
  if (task.taskVisibility !== 'public') {
    return 'Task is not publicly visible.';
  }
  if (task.submissionVisibility !== 'public') {
    return 'Task submissions are not publicly visible.';
  }
  if (task.status !== 'completed') {
    return 'Task is not resolved.';
  }
  return null;
}

function assertEligibleTask(
  task: Pick<Task, 'status' | 'submissionVisibility' | 'taskVisibility'>
): void {
  const reason = taskEligibilityReason(task);
  if (reason) throw new GameCurationError('PRECONDITION_FAILED', reason);
}

function isPlayableHtmlArtifact(
  artifact: Pick<Artifact, 'fileName' | 'mimeType' | 'role' | 'sizeBytes'>
): boolean {
  if (!PLAYABLE_ARTIFACT_ROLES.has(artifact.role)) return false;
  return (
    getInteractiveHtmlEligibility({
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
    }).kind === 'eligible'
  );
}

async function getDeliveryUrl(
  storageUri: string | null,
  options: GameCurationDependencies
): Promise<GameDeliveryUrl | null> {
  if (options.getDeliveryUrl) return options.getDeliveryUrl(storageUri);
  return getGameDeliveryUrl(storageUri, {
    operation: 'curation_artifact',
    storage: options.storage,
  });
}

async function findTask(
  db: Database,
  taskId: string
): Promise<
  Pick<Task, 'description' | 'id' | 'status' | 'submissionVisibility' | 'tags' | 'taskVisibility'>
> {
  const rows = await db
    .select({
      description: tasks.description,
      id: tasks.id,
      status: tasks.status,
      submissionVisibility: tasks.submissionVisibility,
      tags: tasks.tags,
      taskVisibility: tasks.taskVisibility,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  const task = rows[0];
  // Curation only operates on public tasks. Do not return a distinct ineligible response for an
  // unlisted or private task: allowlisted catalog curators are not automatically Taskmarket task
  // viewers, and an existence/metadata oracle here would bypass task visibility controls.
  if (!task || task.taskVisibility !== 'public') {
    throw new GameCurationError('NOT_FOUND', 'Task not found');
  }
  return task;
}

type AcceptedSubmissionResolution =
  | { kind: 'accepted'; submissionId: string }
  | { kind: 'ambiguous' }
  | { kind: 'not_awarded' };

// `task_awards` is authoritative for the awarded worker, but it does not currently persist a
// submission ID. Do not guess when that worker has multiple active submissions: an exact catalog
// source pin must be provably associated with one accepted submission, not merely an awarded
// person. This can become more permissive only once acceptance stores that exact link.
async function resolveAcceptedSubmission(
  db: Database,
  taskId: string,
  workerAddress: string
): Promise<AcceptedSubmissionResolution> {
  const [awardRows, activeSubmissionRows] = await Promise.all([
    db
      .select({ id: taskAwards.id })
      .from(taskAwards)
      .where(
        and(
          eq(taskAwards.taskId, taskId),
          sql`lower(${taskAwards.workerAddress}) = lower(${workerAddress})`
        )
      )
      .limit(1),
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.taskId, taskId),
          isNull(submissions.rejectedAt),
          sql`lower(${submissions.workerAddress}) = lower(${workerAddress})`
        )
      ),
  ]);

  if (awardRows.length === 0) return { kind: 'not_awarded' };
  if (activeSubmissionRows.length !== 1) return { kind: 'ambiguous' };
  return { kind: 'accepted', submissionId: activeSubmissionRows[0]!.id };
}

async function assertAcceptedSubmission(
  db: Database,
  input: { submissionId: string; taskId: string; workerAddress: string }
): Promise<void> {
  const accepted = await resolveAcceptedSubmission(db, input.taskId, input.workerAddress);
  if (accepted.kind === 'not_awarded') {
    throw new GameCurationError('PRECONDITION_FAILED', 'Selected submission was not accepted');
  }
  if (accepted.kind === 'ambiguous') {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Awarded worker must have exactly one active submission for exact accepted-submission provenance'
    );
  }
  if (accepted.submissionId !== input.submissionId) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Selected submission was not accepted');
  }
}

async function findEligibleSource(
  db: Database,
  input: Pick<GameCurationUpsertInput, 'artifactId' | 'submissionId' | 'taskId'>
): Promise<EligibleSource> {
  const task = await findTask(db, input.taskId);
  assertEligibleTask(task);

  const submissionRows = await db
    .select({
      id: submissions.id,
      taskId: submissions.taskId,
      workerAddress: submissions.workerAddress,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.taskId, input.taskId),
        isNull(submissions.rejectedAt)
      )
    )
    .limit(1);
  const submission = submissionRows[0];
  if (!submission) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Selected submission is not active');
  }
  await assertAcceptedSubmission(db, {
    submissionId: submission.id,
    taskId: input.taskId,
    workerAddress: submission.workerAddress,
  });

  const artifactRows = await db
    .select({
      fileName: artifacts.fileName,
      id: artifacts.id,
      keccak256Hash: artifacts.keccak256Hash,
      mimeType: artifacts.mimeType,
      role: artifacts.role,
      sha256Hash: artifacts.sha256Hash,
      sizeBytes: artifacts.sizeBytes,
      storageUri: artifacts.storageUri,
      submissionId: artifacts.submissionId,
      taskId: artifacts.taskId,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.id, input.artifactId),
        eq(artifacts.taskId, input.taskId),
        eq(artifacts.submissionId, input.submissionId)
      )
    )
    .limit(1);
  const artifact = artifactRows[0];
  if (!artifact) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Selected artifact does not match task and submission'
    );
  }
  if (!isPlayableHtmlArtifact(artifact)) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      `Selected artifact is not an eligible playable HTML document of at most ${MAX_INTERACTIVE_HTML_BYTES} bytes`
    );
  }

  return artifact;
}

function isSupportedCoverMimeType(mimeType: string): boolean {
  return SUPPORTED_COVER_MIME_TYPES.has(normalizedMimeType(mimeType));
}

function readPngDimensions(bytes: Buffer): { height: number; width: number } | null {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return null;
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

function readGifDimensions(bytes: Buffer): { height: number; width: number } | null {
  if (
    bytes.length < 10 ||
    (bytes.subarray(0, 6).toString('ascii') !== 'GIF87a' &&
      bytes.subarray(0, 6).toString('ascii') !== 'GIF89a')
  ) {
    return null;
  }
  return { height: bytes.readUInt16LE(8), width: bytes.readUInt16LE(6) };
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readJpegDimensions(bytes: Buffer): { height: number; width: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): { height: number; width: number } | null {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > bytes.length) return null;

    if (type === 'VP8X' && size >= 10) {
      return {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }
    if (
      type === 'VP8 ' &&
      size >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      return {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (type === 'VP8L' && size >= 5 && bytes[dataOffset] === 0x2f) {
      const b0 = bytes[dataOffset + 1]!;
      const b1 = bytes[dataOffset + 2]!;
      const b2 = bytes[dataOffset + 3]!;
      const b3 = bytes[dataOffset + 4]!;
      return {
        width: 1 + (b0 | ((b1 & 0x3f) << 8)),
        height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
      };
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

function imageDimensions(
  bytes: Buffer
): { height: number; mimeType: string; width: number } | null {
  const png = readPngDimensions(bytes);
  if (png) return { ...png, mimeType: 'image/png' };
  const jpeg = readJpegDimensions(bytes);
  if (jpeg) return { ...jpeg, mimeType: 'image/jpeg' };
  const gif = readGifDimensions(bytes);
  if (gif) return { ...gif, mimeType: 'image/gif' };
  const webp = readWebpDimensions(bytes);
  if (webp) return { ...webp, mimeType: 'image/webp' };
  return null;
}

export function validateGameCoverBytes(
  bytes: Buffer,
  declaredMimeType: string
): Omit<PersistedCover, 'artifactId' | 'source' | 'storageUri'> {
  if (bytes.length === 0 || bytes.length > MAX_GAME_COVER_BYTES) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      `Cover must be between 1 byte and ${MAX_GAME_COVER_BYTES} bytes`
    );
  }

  const mimeType = normalizedMimeType(declaredMimeType);
  if (!isSupportedCoverMimeType(mimeType)) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover MIME type is not supported');
  }

  const dimensions = imageDimensions(bytes);
  if (!dimensions || dimensions.mimeType !== mimeType) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Cover bytes do not match the declared supported image MIME type'
    );
  }
  if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width !== dimensions.height) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover must have a square aspect ratio');
  }
  if (dimensions.width > MAX_GAME_COVER_DIMENSION) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      `Cover dimensions must not exceed ${MAX_GAME_COVER_DIMENSION} by ${MAX_GAME_COVER_DIMENSION} pixels`
    );
  }

  return {
    height: dimensions.height,
    mimeType,
    sha256Hash: sha256Hex(bytes),
    width: dimensions.width,
  };
}

export function catalogCoverStorageKey(sha256Hash: string, mimeType: string): string {
  const extension =
    normalizedMimeType(mimeType) === 'image/jpeg'
      ? 'jpg'
      : normalizedMimeType(mimeType).replace(/^image\//, '');
  return `slap-chop-games/covers/sha256/${sha256Hash}.${extension}`;
}

function decodeCoverBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new GameCurationError('BAD_REQUEST', 'Cover must be canonical base64 data');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new GameCurationError('BAD_REQUEST', 'Cover must be canonical base64 data');
  }
  return bytes;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    Number.isSafeInteger(declaredLength) &&
    declaredLength !== null &&
    declaredLength > maxBytes
  ) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover exceeds the maximum byte size');
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new GameCurationError('PRECONDITION_FAILED', 'Cover exceeds the maximum byte size');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let nextChunk = await reader.read();
  while (!nextChunk.done) {
    const value = nextChunk.value;
    if (value) {
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GameCurationError('PRECONDITION_FAILED', 'Cover exceeds the maximum byte size');
      }
      chunks.push(value);
    }
    nextChunk = await reader.read();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    byteLength
  );
}

async function fetchStorageBytes(
  storageUri: string,
  options: GameCurationDependencies
): Promise<Buffer> {
  const delivery = await getDeliveryUrl(storageUri, options);
  if (!delivery) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Cover artifact is not currently deliverable'
    );
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover verification fetch is unavailable');
  }

  let response: Response;
  try {
    response = await fetcher(delivery.url);
  } catch {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover artifact could not be fetched');
  }
  if (!response.ok) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover artifact could not be fetched');
  }

  return readBoundedResponse(response, MAX_GAME_COVER_BYTES);
}

async function findEligibleCoverArtifact(
  db: Database,
  taskId: string,
  artifactId: string
): Promise<
  Pick<Artifact, 'id' | 'mimeType' | 'sha256Hash' | 'storageUri' | 'submissionId' | 'taskId'>
> {
  const task = await findTask(db, taskId);
  assertEligibleTask(task);

  const rows = await db
    .select({
      id: artifacts.id,
      mediaKind: artifacts.mediaKind,
      mimeType: artifacts.mimeType,
      sha256Hash: artifacts.sha256Hash,
      storageUri: artifacts.storageUri,
      submissionId: artifacts.submissionId,
      taskId: artifacts.taskId,
      workerAddress: submissions.workerAddress,
      rejectedAt: submissions.rejectedAt,
    })
    .from(artifacts)
    .innerJoin(submissions, eq(artifacts.submissionId, submissions.id))
    .where(
      and(
        eq(artifacts.id, artifactId),
        eq(artifacts.taskId, taskId),
        eq(submissions.taskId, taskId)
      )
    )
    .limit(1);
  const artifact = rows[0];
  if (!artifact || artifact.rejectedAt !== null) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Cover artifact is not an active task artifact'
    );
  }
  await assertAcceptedSubmission(db, {
    submissionId: artifact.submissionId,
    taskId,
    workerAddress: artifact.workerAddress,
  });
  if (artifact.mediaKind !== 'image' || !isSupportedCoverMimeType(artifact.mimeType)) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover artifact is not a supported image');
  }

  return artifact;
}

async function persistCatalogCover(
  bytes: Buffer,
  validated: Omit<PersistedCover, 'artifactId' | 'source' | 'storageUri'>,
  options: GameCurationDependencies
): Promise<PersistedCover> {
  const storage = options.storage ?? getStorageBackend();
  const key = catalogCoverStorageKey(validated.sha256Hash, validated.mimeType);
  const existing = await storage.headObject(key);
  if (existing && existing.contentLength !== bytes.length) {
    throw new GameCurationError(
      'CONFLICT',
      'Catalog cover digest already refers to an object with a different size'
    );
  }
  if (!existing) {
    await storage.upload(key, bytes, { contentType: validated.mimeType });
  }

  return {
    ...validated,
    artifactId: null,
    source: 'catalog_asset',
    storageUri: storage.storageUriForKey(key),
  };
}

async function resolveCover(
  db: Database,
  taskId: string,
  cover: GameCurationCoverInput,
  options: GameCurationDependencies
): Promise<PersistedCover> {
  if (cover.source === 'catalog_asset') {
    const bytes = decodeCoverBase64(cover.dataBase64);
    const validated = validateGameCoverBytes(bytes, cover.mimeType);
    return persistCatalogCover(bytes, validated, options);
  }

  const artifact = await findEligibleCoverArtifact(db, taskId, cover.artifactId);
  const bytes = await fetchStorageBytes(artifact.storageUri, options);
  const validated = validateGameCoverBytes(bytes, artifact.mimeType);
  if (validated.sha256Hash !== artifact.sha256Hash.toLowerCase()) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Cover artifact hash does not match its pin'
    );
  }

  return {
    ...validated,
    artifactId: artifact.id,
    source: 'artifact',
    storageUri: artifact.storageUri,
  };
}

function coverFromGame(game: Game): PersistedCover | null {
  if (
    !game.coverSource ||
    !game.coverStorageUri ||
    !game.coverSha256Hash ||
    !game.coverMimeType ||
    !game.coverWidth ||
    !game.coverHeight
  ) {
    return null;
  }

  return {
    artifactId: game.coverArtifactId,
    height: game.coverHeight,
    mimeType: game.coverMimeType,
    sha256Hash: game.coverSha256Hash,
    source: game.coverSource as PersistedCover['source'],
    storageUri: game.coverStorageUri,
    width: game.coverWidth,
  };
}

function sameSource(game: Game, source: EligibleSource): boolean {
  return (
    game.taskId === source.taskId &&
    game.submissionId === source.submissionId &&
    game.artifactId === source.id &&
    game.artifactSha256Hash === source.sha256Hash &&
    game.artifactKeccak256Hash === source.keccak256Hash &&
    game.artifactMimeType === source.mimeType &&
    game.artifactSizeBytes === source.sizeBytes
  );
}

function sameCover(left: PersistedCover | null, right: PersistedCover | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.artifactId === right.artifactId &&
    left.height === right.height &&
    left.mimeType === right.mimeType &&
    left.sha256Hash === right.sha256Hash &&
    left.source === right.source &&
    left.storageUri === right.storageUri &&
    left.width === right.width
  );
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function serializeCurationGame(game: Game): GameCurationGame {
  if (game.status !== 'draft' && game.status !== 'published' && game.status !== 'hidden') {
    throw new GameCurationError('PRECONDITION_FAILED', 'Game has an invalid curation status');
  }

  return {
    artifactId: game.artifactId,
    artifactKeccak256Hash: game.artifactKeccak256Hash,
    artifactMimeType: game.artifactMimeType,
    artifactSha256Hash: game.artifactSha256Hash,
    artifactSizeBytes: game.artifactSizeBytes,
    coverAltText: game.coverAltText,
    coverArtifactId: game.coverArtifactId,
    coverHeight: game.coverHeight,
    coverMimeType: game.coverMimeType,
    coverSha256Hash: game.coverSha256Hash,
    coverSource: game.coverSource as GameCurationGame['coverSource'],
    coverWidth: game.coverWidth,
    createdAt: game.createdAt.toISOString(),
    creatorName: game.creatorName,
    description: game.description,
    hiddenAt: toIso(game.hiddenAt),
    id: game.id,
    previewedAt: toIso(game.previewedAt),
    publishedAt: toIso(game.publishedAt),
    slug: game.slug,
    status: game.status,
    submissionId: game.submissionId,
    tags: game.tags,
    taskId: game.taskId,
    title: game.title,
    updatedAt: game.updatedAt.toISOString(),
  };
}

function auditMetadata(game: Game): Record<string, unknown> {
  return {
    cover: {
      artifactId: game.coverArtifactId,
      height: game.coverHeight,
      mimeType: game.coverMimeType,
      sha256Hash: game.coverSha256Hash,
      source: game.coverSource,
      width: game.coverWidth,
    },
    creatorName: game.creatorName,
    description: game.description,
    id: game.id,
    previewedAt: toIso(game.previewedAt),
    publication: {
      hiddenAt: toIso(game.hiddenAt),
      publishedAt: toIso(game.publishedAt),
      status: game.status,
    },
    slug: game.slug,
    source: {
      artifactId: game.artifactId,
      keccak256Hash: game.artifactKeccak256Hash,
      mimeType: game.artifactMimeType,
      sha256Hash: game.artifactSha256Hash,
      sizeBytes: game.artifactSizeBytes,
      submissionId: game.submissionId,
      taskId: game.taskId,
    },
    tags: game.tags,
    title: game.title,
  };
}

async function writeAuditEvent(input: {
  actorPrivyUserId: string;
  after: Game;
  before: Game | null;
  db: Pick<Database, 'insert'>;
  eventId: string;
  action: 'draft_saved' | 'hidden' | 'published';
}): Promise<void> {
  await input.db.insert(gameCurationEvents).values({
    action: input.action,
    actorPrivyUserId: input.actorPrivyUserId,
    afterMetadata: auditMetadata(input.after),
    beforeMetadata: input.before ? auditMetadata(input.before) : null,
    gameId: input.after.id,
    id: input.eventId,
  });
}

async function findGame(db: Database, gameId: string): Promise<Game> {
  const rows = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  const game = rows[0];
  if (!game) throw new GameCurationError('NOT_FOUND', 'Game not found');
  return game;
}

async function assertCoverStillValid(
  db: Database,
  game: Game,
  options: GameCurationDependencies
): Promise<void> {
  const cover = coverFromGame(game);
  if (!cover) {
    throw new GameCurationError('PRECONDITION_FAILED', 'A verified square cover is required');
  }
  if (cover.source === 'artifact') {
    if (!cover.artifactId) {
      throw new GameCurationError('PRECONDITION_FAILED', 'Cover artifact reference is missing');
    }
    const artifact = await findEligibleCoverArtifact(db, game.taskId, cover.artifactId);
    if (
      artifact.storageUri !== cover.storageUri ||
      artifact.sha256Hash.toLowerCase() !== cover.sha256Hash
    ) {
      throw new GameCurationError(
        'PRECONDITION_FAILED',
        'Cover artifact no longer matches its pin'
      );
    }
  } else if (cover.source !== 'catalog_asset' || cover.artifactId !== null) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover provenance is invalid');
  }

  const bytes = await fetchStorageBytes(cover.storageUri, options);
  const validated = validateGameCoverBytes(bytes, cover.mimeType);
  if (
    validated.sha256Hash !== cover.sha256Hash ||
    validated.width !== cover.width ||
    validated.height !== cover.height
  ) {
    throw new GameCurationError('PRECONDITION_FAILED', 'Cover bytes no longer match their pin');
  }
}

async function assertSourceStillDeliverable(
  source: EligibleSource,
  options: GameCurationDependencies
): Promise<void> {
  const delivery = await getDeliveryUrl(source.storageUri, options);
  if (!delivery) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Selected game artifact is not currently deliverable'
    );
  }
}

// Implements: ADR-0088. This resolver returns only curator-safe, accepted, public candidates
// and short-lived preview URLs; it never emits a storage URI or object key.
export async function resolveTaskForGameCuration(
  db: Database,
  taskId: string,
  options: GameCurationDependencies = {}
): Promise<GameCurationResolvedTask> {
  const task = await findTask(db, taskId);
  const reason = taskEligibilityReason(task);
  const response = {
    task: {
      description: task.description,
      id: task.id,
      status: task.status,
      tags: task.tags,
    },
  };
  if (reason) {
    return { ...response, eligibilityReason: reason, eligible: false, submissions: [] };
  }

  const [awardRows, submissionRows] = await Promise.all([
    db
      .select({ workerAddress: taskAwards.workerAddress })
      .from(taskAwards)
      .where(eq(taskAwards.taskId, taskId)),
    db
      .select({
        id: submissions.id,
        submittedAt: submissions.submittedAt,
        workerAddress: submissions.workerAddress,
      })
      .from(submissions)
      .where(and(eq(submissions.taskId, taskId), isNull(submissions.rejectedAt))),
  ]);
  const acceptedWorkers = new Set(awardRows.map((award) => award.workerAddress.toLowerCase()));
  const activeSubmissionsByWorker = new Map<string, typeof submissionRows>();
  for (const submission of submissionRows) {
    const workerAddress = submission.workerAddress.toLowerCase();
    const activeSubmissions = activeSubmissionsByWorker.get(workerAddress) ?? [];
    activeSubmissions.push(submission);
    activeSubmissionsByWorker.set(workerAddress, activeSubmissions);
  }
  const acceptedSubmissions = submissionRows.filter((submission) => {
    const workerAddress = submission.workerAddress.toLowerCase();
    return (
      acceptedWorkers.has(workerAddress) &&
      activeSubmissionsByWorker.get(workerAddress)?.length === 1
    );
  });
  if (acceptedSubmissions.length === 0) {
    const hasAmbiguousAwardedWorker = [...acceptedWorkers].some(
      (workerAddress) => activeSubmissionsByWorker.get(workerAddress)?.length !== 1
    );
    return {
      ...response,
      eligibilityReason: hasAmbiguousAwardedWorker
        ? 'Awarded workers must have exactly one active submission for exact accepted-submission provenance.'
        : 'Task has no active accepted submissions.',
      eligible: false,
      submissions: [],
    };
  }

  const submissionIds = acceptedSubmissions.map((submission) => submission.id);
  const artifactRows = await db
    .select({
      fileName: artifacts.fileName,
      id: artifacts.id,
      keccak256Hash: artifacts.keccak256Hash,
      mimeType: artifacts.mimeType,
      role: artifacts.role,
      sha256Hash: artifacts.sha256Hash,
      sizeBytes: artifacts.sizeBytes,
      storageUri: artifacts.storageUri,
      submissionId: artifacts.submissionId,
    })
    .from(artifacts)
    .where(and(eq(artifacts.taskId, taskId), inArray(artifacts.submissionId, submissionIds)));
  const playableArtifacts = artifactRows.filter((artifact) => isPlayableHtmlArtifact(artifact));

  const deliveryByArtifact = new Map<string, GameDeliveryUrl | null>(
    await Promise.all(
      playableArtifacts.map(
        async (artifact) =>
          [artifact.id, await getDeliveryUrl(artifact.storageUri, options)] as const
      )
    )
  );
  const eligibleArtifacts = playableArtifacts.filter((artifact) =>
    deliveryByArtifact.get(artifact.id)
  );
  const curationSubmissions = acceptedSubmissions
    .map((submission) => ({
      artifacts: eligibleArtifacts
        .filter((artifact) => artifact.submissionId === submission.id)
        .map((artifact) => {
          const delivery = deliveryByArtifact.get(artifact.id)!;
          return {
            fileName: artifact.fileName,
            id: artifact.id,
            keccak256Hash: artifact.keccak256Hash,
            mimeType: artifact.mimeType,
            previewUrl: delivery.url,
            previewUrlExpiresAt: delivery.expiresAt,
            role: artifact.role as 'final' | 'preview',
            sha256Hash: artifact.sha256Hash,
            sizeBytes: artifact.sizeBytes,
          };
        }),
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      workerAddress: submission.workerAddress,
    }))
    .filter((submission) => submission.artifacts.length > 0);

  if (curationSubmissions.length === 0) {
    return {
      ...response,
      eligibilityReason: 'Task has no currently deliverable playable HTML artifacts.',
      eligible: false,
      submissions: [],
    };
  }

  return { ...response, eligibilityReason: null, eligible: true, submissions: curationSubmissions };
}

// Implements: ADR-0087 and ADR-0088. A source can change only while a game is non-public, and
// any source change clears the curator preview attestation so publish cannot reuse stale review.
export async function upsertGameCuration(
  db: Database,
  actorPrivyUserId: string,
  input: GameCurationUpsertInput,
  options: GameCurationDependencies = {}
): Promise<Game> {
  const existing = input.gameId ? await findGame(db, input.gameId) : null;
  if (existing?.status === 'published') {
    throw new GameCurationError('CONFLICT', 'Hide a published game before editing it');
  }

  const source = await findEligibleSource(db, input);
  const existingCover = existing ? coverFromGame(existing) : null;
  const cover =
    input.cover === undefined
      ? existingCover
      : input.cover === null
        ? null
        : await resolveCover(db, input.taskId, input.cover, options);
  const sourceChanged = !existing || !sameSource(existing, source);
  const coverChanged = !sameCover(existingCover, cover);
  const now = nowFor(options);
  const gameId = existing?.id ?? idFor(options);
  const coverAltText =
    cover === null
      ? null
      : input.coverAltText !== undefined
        ? input.coverAltText
        : coverChanged
          ? null
          : (existing?.coverAltText ?? null);
  const previewedAt =
    input.previewed === true ? now : sourceChanged ? null : (existing?.previewedAt ?? null);
  const values = {
    artifactId: source.id,
    artifactKeccak256Hash: source.keccak256Hash,
    artifactMimeType: source.mimeType,
    artifactSha256Hash: source.sha256Hash,
    artifactSizeBytes: source.sizeBytes,
    coverAltText,
    coverArtifactId: cover?.artifactId ?? null,
    coverHeight: cover?.height ?? null,
    coverMimeType: cover?.mimeType ?? null,
    coverSha256Hash: cover?.sha256Hash ?? null,
    coverSource: cover?.source ?? null,
    coverStorageUri: cover?.storageUri ?? null,
    coverWidth: cover?.width ?? null,
    creatorName: input.creatorName ?? null,
    description: input.description ?? null,
    hiddenAt: null,
    previewedAt,
    publishedAt: null,
    slug: input.slug,
    status: 'draft' as const,
    submissionId: source.submissionId,
    tags: input.tags,
    taskId: source.taskId,
    title: input.title,
    updatedAt: now,
  };

  try {
    return await db.transaction(async (tx) => {
      let saved: Game;
      if (existing) {
        const rows = await tx
          .update(games)
          .set(values)
          .where(
            and(
              eq(games.id, gameId),
              eq(games.status, existing.status),
              eq(games.updatedAt, existing.updatedAt)
            )
          )
          .returning();
        saved = rows[0]!;
        if (!saved) {
          throw new GameCurationError('CONFLICT', 'Game changed before it could be saved');
        }
      } else {
        const rows = await tx
          .insert(games)
          .values({ ...values, createdAt: now, id: gameId })
          .returning();
        saved = rows[0]!;
      }
      await writeAuditEvent({
        action: 'draft_saved',
        actorPrivyUserId,
        after: saved,
        before: existing,
        db: tx,
        eventId: idFor(options),
      });
      return saved;
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      throw new GameCurationError('CONFLICT', 'A game already uses this slug');
    }
    throw error;
  }
}

// Implements: ADR-0087 and ADR-0088. Publishing rechecks the exact immutable source and cover
// pins immediately before making the game public, rather than trusting an earlier draft lookup.
export async function publishGameCuration(
  db: Database,
  actorPrivyUserId: string,
  gameId: string,
  options: GameCurationDependencies = {}
): Promise<Game> {
  const existing = await findGame(db, gameId);
  if (existing.status === 'published') {
    throw new GameCurationError('CONFLICT', 'Game is already published');
  }
  if (existing.status !== 'draft' && existing.status !== 'hidden') {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Game cannot be published from its current state'
    );
  }
  if (!existing.previewedAt) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Load and review the exact game artifact in the shared sandbox before publishing'
    );
  }

  const source = await findEligibleSource(db, existing);
  if (!sameSource(existing, source)) {
    throw new GameCurationError(
      'PRECONDITION_FAILED',
      'Selected game artifact no longer matches its pin'
    );
  }
  await Promise.all([
    assertSourceStillDeliverable(source, options),
    assertCoverStillValid(db, existing, options),
  ]);

  const now = nowFor(options);
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(games)
      .set({ hiddenAt: null, publishedAt: now, status: 'published', updatedAt: now })
      .where(
        and(
          eq(games.id, gameId),
          eq(games.status, existing.status),
          eq(games.updatedAt, existing.updatedAt)
        )
      )
      .returning();
    const saved = rows[0];
    if (!saved) {
      throw new GameCurationError('CONFLICT', 'Game changed before it could be published');
    }
    await writeAuditEvent({
      action: 'published',
      actorPrivyUserId,
      after: saved,
      before: existing,
      db: tx,
      eventId: idFor(options),
    });
    return saved;
  });
}

// Implements: ADR-0088. A hide is a durable, audited state transition; the public catalog sees
// only `published`, so the transition takes effect on the next public read without deleting pins.
export async function hideGameCuration(
  db: Database,
  actorPrivyUserId: string,
  gameId: string,
  options: GameCurationDependencies = {}
): Promise<Game> {
  const existing = await findGame(db, gameId);
  if (existing.status !== 'published') {
    throw new GameCurationError('CONFLICT', 'Only published games can be hidden');
  }

  const now = nowFor(options);
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(games)
      .set({ hiddenAt: now, status: 'hidden', updatedAt: now })
      .where(and(eq(games.id, gameId), eq(games.status, 'published')))
      .returning();
    const saved = rows[0];
    if (!saved) {
      throw new GameCurationError('CONFLICT', 'Game changed before it could be hidden');
    }
    await writeAuditEvent({
      action: 'hidden',
      actorPrivyUserId,
      after: saved,
      before: existing,
      db: tx,
      eventId: idFor(options),
    });
    return saved;
  });
}
