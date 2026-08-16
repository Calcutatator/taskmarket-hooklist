import { z } from 'zod';
import { TASK_DESCRIPTION_MAX_LENGTH } from './task.schemas';

const Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase SHA-256 hash');
const Keccak256HashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 0x-prefixed Keccak-256 hash');

export const GameStatusSchema = z.enum(['draft', 'published', 'hidden']);
export const GameCoverSourceSchema = z.enum(['artifact', 'catalog_asset']);
export const GameIdSchema = z.string().trim().min(1).max(120);
export const GameVoteValueSchema = z.union([z.literal(-1), z.literal(1)]);

export const GameListInputSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(48).optional().default(24),
});

export const GameGetInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Game slugs must be lowercase kebab-case'),
});

// A vote is an intentional value selection rather than a boolean toggle. The backend compares
// it with the canonical selected row: repeating the active value removes that row, while the
// opposite value replaces it. See ADR-0089.
export const GameVoteInputSchema = z.object({
  gameId: GameIdSchema,
  value: GameVoteValueSchema,
});

// This authenticated read gives the browser the server's canonical selected vote before an
// optimistic mutation. It deliberately has no anonymous variant: catalog reads stay anonymous,
// but a selected vote is private to the authenticated Privy user.
export const GameVoteStateInputSchema = z.object({
  gameId: GameIdSchema,
});

export const GameSourceSchema = z.object({
  taskId: z.string().min(1),
  submissionId: z.string().min(1),
  artifactId: z.string().min(1),
  artifactSha256Hash: Sha256HashSchema,
  artifactKeccak256Hash: Keccak256HashSchema,
  artifactMimeType: z.string().min(1).max(120),
  artifactSizeBytes: z.number().int().nonnegative(),
});

const GameCatalogFieldsSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  // Optional so a newly deployed catalog client can continue reading responses from an
  // older backend during a rolling release. The backend supplies it once available.
  taskDescription: z.string().max(TASK_DESCRIPTION_MAX_LENGTH).optional(),
  creatorName: z.string().max(120).nullable(),
  tags: z.array(z.string().min(1).max(64)).max(20),
  // This is a short-lived delivery URL when the cover can be served. Storage keys and
  // durable storage URIs are deliberately not part of the public catalog contract.
  coverUrl: z.string().url().nullable(),
  coverAltText: z.string().max(240).nullable(),
  upvoteCount: z.number().int().nonnegative(),
  downvoteCount: z.number().int().nonnegative(),
  netVotes: z.number().int(),
  publishedAt: z.string().datetime(),
});

export const GameCatalogItemSchema = GameCatalogFieldsSchema;

export const GameDetailResponseSchema = GameCatalogFieldsSchema.extend({
  source: GameSourceSchema,
  // Minted from the exact pinned artifact only after the backend rechecks the stored hashes.
  // A fresh games.get call refreshes this short-lived URL; storage keys never leave the backend.
  artifactUrl: z.string().url().nullable(),
  artifactUrlExpiresAt: z.string().datetime().nullable(),
});

export const GameListResponseSchema = z.object({
  games: z.array(GameCatalogItemSchema),
  nextCursor: z.string().nullable(),
});

export const GameVoteResponseSchema = z.object({
  gameId: GameIdSchema,
  upvoteCount: z.number().int().nonnegative(),
  downvoteCount: z.number().int().nonnegative(),
  netVotes: z.number().int(),
  selectedVote: GameVoteValueSchema.nullable(),
});

export const GameVoteStateResponseSchema = GameVoteResponseSchema;

export type GameStatus = z.infer<typeof GameStatusSchema>;
export type GameCoverSource = z.infer<typeof GameCoverSourceSchema>;
export type GameListInput = z.infer<typeof GameListInputSchema>;
export type GameGetInput = z.infer<typeof GameGetInputSchema>;
export type GameVoteValue = z.infer<typeof GameVoteValueSchema>;
export type GameVoteInput = z.infer<typeof GameVoteInputSchema>;
export type GameVoteStateInput = z.infer<typeof GameVoteStateInputSchema>;
export type GameSource = z.infer<typeof GameSourceSchema>;
export type GameCatalogItem = z.infer<typeof GameCatalogItemSchema>;
export type GameDetailResponse = z.infer<typeof GameDetailResponseSchema>;
export type GameListResponse = z.infer<typeof GameListResponseSchema>;
export type GameVoteResponse = z.infer<typeof GameVoteResponseSchema>;
export type GameVoteStateResponse = z.infer<typeof GameVoteStateResponseSchema>;
