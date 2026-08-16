import { z } from 'zod';

import { GameCoverSourceSchema, GameStatusSchema } from './games.schemas';
import { ArtifactRole } from './submission.schemas';

const Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase SHA-256 hash');
const Keccak256HashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 0x-prefixed Keccak-256 hash');

export const MAX_GAME_COVER_BYTES = 4 * 1024 * 1024;
export const MAX_GAME_COVER_DIMENSION = 4_096;
export const MAX_GAME_COVER_BASE64_CHARS = Math.ceil(MAX_GAME_COVER_BYTES / 3) * 4 + 4;

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

const GameIdSchema = z.string().trim().min(1).max(120);
const TaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !hasAsciiControlCharacter(value), 'Task ID contains control characters');
const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Game slugs must be lowercase kebab-case');
const TitleSchema = z.string().trim().min(1).max(120);
const OptionalTextSchema = z.string().trim().max(2_000).nullable().optional();
const OptionalCreatorSchema = z.string().trim().max(120).nullable().optional();
const OptionalAltTextSchema = z.string().trim().max(240).nullable().optional();
const TagsSchema = z.array(z.string().trim().min(1).max(64)).max(20);

const CANONICAL_TASKMARKET_HOST = 'taskmarket.dev';

/**
 * Converts either a direct Taskmarket task ID or the public canonical task URL into the exact
 * database ID. Only the production Taskmarket hostname and `/tasks/{id}` route are accepted;
 * accepting arbitrary hosts here would turn a curator paste field into an open URL parser.
 */
export function normalizeGameCurationTaskReference(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error('Task reference is required');
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return TaskIdSchema.parse(trimmed);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Task reference must be a task ID or canonical Taskmarket task URL');
  }
  const hasCanonicalAuthority = /^https:\/\/taskmarket\.dev(?:[/?#]|$)/.test(trimmed);
  if (
    !hasCanonicalAuthority ||
    url.protocol !== 'https:' ||
    url.hostname !== CANONICAL_TASKMARKET_HOST ||
    url.port
  ) {
    throw new Error('Task URL must use the canonical https://taskmarket.dev hostname');
  }

  const match = /^\/tasks\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    throw new Error('Task URL must use the canonical /tasks/{taskId} path');
  }

  try {
    return TaskIdSchema.parse(decodeURIComponent(match[1]!));
  } catch {
    throw new Error('Task URL contains an invalid task ID');
  }
}

export const GameCurationTaskReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .transform((reference, ctx) => {
    try {
      return normalizeGameCurationTaskReference(reference);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid task reference',
      });
      return z.NEVER;
    }
  });

export const GameCurationResolveTaskInputSchema = z.object({
  // Query-safe on GET requests. It accepts both a raw ID and a canonical public task URL,
  // then stores only the normalized ID in `reference` for the backend resolver.
  reference: GameCurationTaskReferenceSchema,
});

export const GameCurationArtifactSchema = z.object({
  id: GameIdSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  role: ArtifactRole,
  sizeBytes: z.number().int().nonnegative(),
  sha256Hash: Sha256HashSchema,
  keccak256Hash: Keccak256HashSchema,
  previewUrl: z.string().url().nullable(),
  previewUrlExpiresAt: z.string().datetime().nullable(),
});

export const GameCurationSubmissionSchema = z.object({
  id: GameIdSchema,
  workerAddress: z.string().min(1),
  submittedAt: z.string().datetime(),
  artifacts: z.array(GameCurationArtifactSchema),
});

export const GameCurationResolvedTaskSchema = z.object({
  task: z.object({
    id: TaskIdSchema,
    description: z.string(),
    status: z.string(),
    tags: z.array(z.string()),
  }),
  eligible: z.boolean(),
  eligibilityReason: z.string().nullable(),
  submissions: z.array(GameCurationSubmissionSchema),
});

export const GameCurationArtifactCoverInputSchema = z.object({
  source: z.literal('artifact'),
  artifactId: GameIdSchema,
});

export const GameCurationCatalogAssetCoverInputSchema = z.object({
  source: z.literal('catalog_asset'),
  dataBase64: z.string().min(4).max(MAX_GAME_COVER_BASE64_CHARS),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
});

export const GameCurationCoverInputSchema = z.discriminatedUnion('source', [
  GameCurationArtifactCoverInputSchema,
  GameCurationCatalogAssetCoverInputSchema,
]);

export const GameCurationUpsertInputSchema = z.object({
  gameId: GameIdSchema.optional(),
  taskId: TaskIdSchema,
  submissionId: GameIdSchema,
  artifactId: GameIdSchema,
  title: TitleSchema,
  slug: SlugSchema,
  description: OptionalTextSchema,
  creatorName: OptionalCreatorSchema,
  tags: TagsSchema.default([]),
  cover: GameCurationCoverInputSchema.nullable().optional(),
  coverAltText: OptionalAltTextSchema,
  // Set only after the curator has successfully loaded the exact pin in the shared
  // sandbox. The server records this affirmative, authenticated curator attestation.
  previewed: z.boolean().optional(),
});

export const GameCurationGameSchema = z.object({
  id: GameIdSchema,
  slug: SlugSchema,
  title: TitleSchema,
  description: z.string().nullable(),
  creatorName: z.string().nullable(),
  tags: TagsSchema,
  status: GameStatusSchema,
  taskId: TaskIdSchema,
  submissionId: GameIdSchema,
  artifactId: GameIdSchema,
  artifactSha256Hash: Sha256HashSchema,
  artifactKeccak256Hash: Keccak256HashSchema,
  artifactMimeType: z.string().min(1).max(120),
  artifactSizeBytes: z.number().int().nonnegative(),
  coverSource: GameCoverSourceSchema.nullable(),
  coverArtifactId: GameIdSchema.nullable(),
  coverSha256Hash: Sha256HashSchema.nullable(),
  coverMimeType: z.string().min(1).max(120).nullable(),
  coverWidth: z.number().int().positive().nullable(),
  coverHeight: z.number().int().positive().nullable(),
  coverAltText: z.string().max(240).nullable(),
  previewedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  hiddenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GameCurationMutationResponseSchema = z.object({
  game: GameCurationGameSchema,
});

export const GameCurationPublishInputSchema = z.object({
  gameId: GameIdSchema,
});

export const GameCurationHideInputSchema = z.object({
  gameId: GameIdSchema,
});

export type GameCurationResolveTaskInput = z.infer<typeof GameCurationResolveTaskInputSchema>;
export type GameCurationArtifact = z.infer<typeof GameCurationArtifactSchema>;
export type GameCurationSubmission = z.infer<typeof GameCurationSubmissionSchema>;
export type GameCurationResolvedTask = z.infer<typeof GameCurationResolvedTaskSchema>;
export type GameCurationCoverInput = z.infer<typeof GameCurationCoverInputSchema>;
export type GameCurationUpsertInput = z.infer<typeof GameCurationUpsertInputSchema>;
export type GameCurationGame = z.infer<typeof GameCurationGameSchema>;
export type GameCurationMutationResponse = z.infer<typeof GameCurationMutationResponseSchema>;
export type GameCurationPublishInput = z.infer<typeof GameCurationPublishInputSchema>;
export type GameCurationHideInput = z.infer<typeof GameCurationHideInputSchema>;
