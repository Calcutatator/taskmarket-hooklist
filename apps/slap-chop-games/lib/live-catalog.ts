import { createHash } from 'node:crypto';
import {
  GameGetInputSchema,
  GameListInputSchema,
  type GameCatalogItem,
  type GameDetailResponse,
  type GameListInput,
  type GameListResponse,
} from '@taskmarket/shared';
import {
  getInteractiveHtmlEligibility,
  MAX_INTERACTIVE_HTML_BYTES,
} from '@taskmarket/html-sandbox';
import { z } from 'zod';

import { getEnvironment } from '@/lib/environment';

const LIVE_SOURCE_TIMEOUT_MS = 8_000;
const LIVE_SOURCE_CACHE_MS = 60_000;
const PROXY_DELIVERY_TTL_MS = 5 * 60_000;

const liveTaskSchema = z.object({
  description: z.string(),
  id: z.string(),
  primaryAward: z
    .object({
      workerAddress: z.string(),
    })
    .nullable(),
  status: z.string(),
  submissionVisibility: z.string(),
  tags: z.array(z.string()),
  taskVisibility: z.string(),
});

const liveArtifactSchema = z.object({
  fileName: z.string(),
  id: z.string(),
  keccak256Hash: z.string(),
  mimeType: z.string(),
  previewExpiresAt: z.string().datetime().nullable().optional(),
  previewUrl: z.string().url().nullable().optional(),
  role: z.enum(['preview', 'source', 'final', 'attachment']),
  sha256Hash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

const liveSubmissionSchema = z.object({
  artifacts: z.array(liveArtifactSchema),
  id: z.string(),
  rejectedAt: z.string().datetime().nullable(),
  workerAddress: z.string(),
});

const liveSubmissionsSchema = z.array(liveSubmissionSchema);

type LiveGamePin = {
  coverAltText: string;
  coverPath: string;
  creatorName: string;
  description: string;
  publishedAt: string;
  slug: string;
  source: {
    artifactHost: string;
    artifactId: string;
    artifactKeccak256Hash: string;
    artifactMimeType: string;
    artifactRole: 'final' | 'preview';
    artifactSha256Hash: string;
    artifactSizeBytes: number;
    fileName: string;
    submissionId: string;
    taskId: string;
    workerAddress: string;
  };
  tags: string[];
  title: string;
};

// This allowlist is deliberately exact. Live-readonly mode is a curated catalog source, not a
// general production task or storage proxy. Every change to a pin must review the source game and
// update both content hashes from the public Taskmarket record.
export const LIVE_GAME_PINS = [
  {
    coverAltText: 'A broken amber memory grid surrounding a bright arcade core',
    coverPath: '/live-catalog/used-memory.svg',
    creatorName: 'Agent 60178',
    description: 'Repair an unstable memory board against the clock in a compact coin-op game.',
    publishedAt: '2026-07-31T04:11:39.000Z',
    slug: 'used-memory',
    source: {
      artifactHost: 'taskmarket.05176d1643896a390ad5d6c4da10ce30.r2.cloudflarestorage.com',
      artifactId: 'ed225485-adeb-4761-95e0-9e2a2425b6a6',
      artifactKeccak256Hash: '0xa0a8bf2c73473c89dba3b11e1138dba6447d2071e689c49994c83c8af5adc14d',
      artifactMimeType: 'application/octet-stream',
      artifactRole: 'final',
      artifactSha256Hash: 'd3a28a9948b17337b0f9d6e93de84ab6cc82490f8b2426886823d66707bd60f6',
      artifactSizeBytes: 17_251,
      fileName: 'index.html',
      submissionId: '2ebf1fb7-1622-40dd-907e-a2ad1a15837e',
      taskId: '0xbd98da7dabffd48d32fefb3da160251f5909cece3d1faa79d2d7ddd351bcb1e9',
      workerAddress: '0x52d027bf9282746946708fa499dddf659f4e390c',
    },
    tags: ['arcade', 'memory', 'retro'],
    title: 'Used Memory',
  },
  {
    coverAltText: 'A glowing receiver dial cutting through bands of television static',
    coverPath: '/live-catalog/please-stand-by.svg',
    creatorName: 'Agent 60223',
    description: 'Tune a physical receiver through the noise of a world that never existed.',
    publishedAt: '2026-07-31T04:12:00.000Z',
    slug: 'please-stand-by',
    source: {
      artifactHost: 'taskmarket.05176d1643896a390ad5d6c4da10ce30.r2.cloudflarestorage.com',
      artifactId: '0727d736-328e-40a9-8388-84c1314f8f9f',
      artifactKeccak256Hash: '0x29c63cb293fe0fb926d8f843c1bc6023006e40ed393ab268207417c0680954fe',
      artifactMimeType: 'application/octet-stream',
      artifactRole: 'final',
      artifactSha256Hash: '7c1fe3357bec8f2dfc78934959b851ac7517392722136c497c307213f1a44764',
      artifactSizeBytes: 3_568_475,
      fileName: 'receiver.html',
      submissionId: '2142f30c-8ae4-423f-b840-1aa9c27153d5',
      taskId: '0xf4739b205ba9e4b806f596bf0323376418937d4ae9e7fde404b366f51d337752',
      workerAddress: '0x936c9b0ac3fd771b9b5e0d06787861f5528ae8a3',
    },
    tags: ['interactive', 'receiver', 'atmospheric'],
    title: 'Please Stand By',
  },
] as const satisfies readonly LiveGamePin[];

type ResolvedLiveGame = {
  artifactUrl: string;
  artifactUrlExpiresAt: string | null;
  item: GameCatalogItem;
  pin: LiveGamePin;
};

type LiveCatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type LiveCatalogDependencies = {
  fetcher?: LiveCatalogFetch;
  now?: () => Date;
  siteUrl?: string;
  sourceApiUrl?: string;
};

export class LiveCatalogError extends Error {
  constructor(
    readonly kind: 'integrity' | 'not-found' | 'source-invalid' | 'source-unavailable',
    message: string
  ) {
    super(message);
    this.name = 'LiveCatalogError';
  }
}

const resolutionCache = new Map<string, { expiresAt: number; value: ResolvedLiveGame }>();

function normalizedAddress(value: string): string {
  return value.toLowerCase();
}

function dependencies(options: LiveCatalogDependencies): Required<LiveCatalogDependencies> {
  const environment = getEnvironment();
  const sourceApiUrl = options.sourceApiUrl ?? environment.SLAP_CHOP_LIVE_SOURCE_API_URL;

  if (!sourceApiUrl) {
    throw new LiveCatalogError('source-invalid', 'The live catalog source is not configured.');
  }

  return {
    fetcher: options.fetcher ?? fetch,
    now: options.now ?? (() => new Date()),
    siteUrl: options.siteUrl ?? environment.NEXT_PUBLIC_SITE_URL,
    sourceApiUrl,
  };
}

function sourceUrl(baseUrl: string, path: string): URL {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
}

async function fetchJson(
  url: URL,
  fetcher: LiveCatalogFetch,
  schema: typeof liveTaskSchema | typeof liveSubmissionsSchema
): Promise<z.infer<typeof liveTaskSchema> | z.infer<typeof liveSubmissionsSchema>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LIVE_SOURCE_TIMEOUT_MS),
    });
  } catch {
    throw new LiveCatalogError('source-unavailable', 'The production source could not be reached.');
  }

  if (!response.ok) {
    throw new LiveCatalogError(
      'source-unavailable',
      `The production source returned HTTP ${response.status}.`
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LiveCatalogError('source-invalid', 'The production source returned unreadable JSON.');
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new LiveCatalogError('source-invalid', 'The production source response changed shape.');
  }

  return parsed.data;
}

function assertPinnedArtifact(
  pin: LiveGamePin,
  artifact: z.infer<typeof liveArtifactSchema>
): void {
  const source = pin.source;
  if (
    artifact.id !== source.artifactId ||
    artifact.fileName !== source.fileName ||
    artifact.mimeType !== source.artifactMimeType ||
    artifact.role !== source.artifactRole ||
    artifact.sizeBytes !== source.artifactSizeBytes ||
    artifact.sha256Hash !== source.artifactSha256Hash ||
    artifact.keccak256Hash !== source.artifactKeccak256Hash
  ) {
    throw new LiveCatalogError('integrity', `Production metadata no longer matches ${pin.slug}.`);
  }

  const eligibility = getInteractiveHtmlEligibility({
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
  });
  if (eligibility.kind !== 'eligible') {
    throw new LiveCatalogError('source-invalid', `${pin.slug} is no longer playable HTML.`);
  }
}

function assertPinnedDeliveryUrl(
  pin: LiveGamePin,
  artifact: z.infer<typeof liveArtifactSchema>,
  now: Date
): string {
  if (!artifact.previewUrl || !artifact.previewExpiresAt) {
    throw new LiveCatalogError('source-unavailable', `${pin.slug} is not currently deliverable.`);
  }

  const url = new URL(artifact.previewUrl);
  if (url.protocol !== 'https:' || url.hostname !== pin.source.artifactHost) {
    throw new LiveCatalogError(
      'source-invalid',
      `${pin.slug} returned an unexpected artifact delivery host.`
    );
  }

  if (new Date(artifact.previewExpiresAt).getTime() <= now.getTime()) {
    throw new LiveCatalogError(
      'source-unavailable',
      `${pin.slug} returned an expired delivery URL.`
    );
  }

  return url.toString();
}

function catalogItem(pin: LiveGamePin, taskDescription: string, siteUrl: string): GameCatalogItem {
  return {
    coverAltText: pin.coverAltText,
    coverUrl: new URL(pin.coverPath, `${siteUrl.replace(/\/+$/, '')}/`).toString(),
    creatorName: pin.creatorName,
    description: pin.description,
    downvoteCount: 0,
    id: `live-${pin.source.artifactId}`,
    netVotes: 0,
    publishedAt: pin.publishedAt,
    slug: pin.slug,
    tags: [...pin.tags],
    taskDescription,
    title: pin.title,
    upvoteCount: 0,
  };
}

async function resolveLiveGame(
  pin: LiveGamePin,
  options: LiveCatalogDependencies = {}
): Promise<ResolvedLiveGame> {
  const resolvedDependencies = dependencies(options);
  const cache = options.fetcher ? null : resolutionCache.get(pin.slug);
  const now = resolvedDependencies.now();
  if (cache && cache.expiresAt > now.getTime()) {
    return cache.value;
  }

  const taskUrl = sourceUrl(
    resolvedDependencies.sourceApiUrl,
    `/api/tasks/${encodeURIComponent(pin.source.taskId)}`
  );
  const submissionsUrl = sourceUrl(
    resolvedDependencies.sourceApiUrl,
    `/api/tasks/${encodeURIComponent(pin.source.taskId)}/submissions`
  );
  submissionsUrl.searchParams.set('includePreviewUrls', 'media');

  const [taskPayload, submissionsPayload] = await Promise.all([
    fetchJson(taskUrl, resolvedDependencies.fetcher, liveTaskSchema),
    fetchJson(submissionsUrl, resolvedDependencies.fetcher, liveSubmissionsSchema),
  ]);
  const task = liveTaskSchema.parse(taskPayload);
  const submissions = liveSubmissionsSchema.parse(submissionsPayload);
  const awardedWorker = task.primaryAward?.workerAddress;

  if (
    task.id !== pin.source.taskId ||
    task.status !== 'completed' ||
    task.taskVisibility !== 'public' ||
    task.submissionVisibility !== 'public' ||
    !awardedWorker ||
    normalizedAddress(awardedWorker) !== normalizedAddress(pin.source.workerAddress)
  ) {
    throw new LiveCatalogError('source-invalid', `${pin.slug} is not an accepted public source.`);
  }

  const pinnedSubmissions = submissions.filter(
    (submission) =>
      submission.rejectedAt === null &&
      submission.id === pin.source.submissionId &&
      normalizedAddress(submission.workerAddress) === normalizedAddress(pin.source.workerAddress)
  );
  if (pinnedSubmissions.length !== 1) {
    throw new LiveCatalogError(
      'source-invalid',
      `${pin.slug} no longer has its exact pinned awarded submission.`
    );
  }

  const artifact = pinnedSubmissions[0]!.artifacts.find(
    (candidate) => candidate.id === pin.source.artifactId
  );
  if (!artifact) {
    throw new LiveCatalogError('source-unavailable', `${pin.slug} is not currently deliverable.`);
  }
  assertPinnedArtifact(pin, artifact);
  const artifactUrl = assertPinnedDeliveryUrl(pin, artifact, now);

  const value = {
    artifactUrl,
    artifactUrlExpiresAt: artifact.previewExpiresAt ?? null,
    item: catalogItem(pin, task.description, resolvedDependencies.siteUrl),
    pin,
  };
  if (!options.fetcher) {
    resolutionCache.set(pin.slug, {
      expiresAt: now.getTime() + LIVE_SOURCE_CACHE_MS,
      value,
    });
  }
  return value;
}

function pinForSlug(slug: string): LiveGamePin | null {
  return LIVE_GAME_PINS.find((pin) => pin.slug === slug) ?? null;
}

export async function listLiveCatalog(
  input: GameListInput,
  options: LiveCatalogDependencies = {}
): Promise<GameListResponse> {
  const parsedInput = GameListInputSchema.parse(input);
  if (parsedInput.cursor) {
    throw new LiveCatalogError('source-invalid', 'The live catalog does not accept cursors.');
  }

  const resolved = await Promise.allSettled(
    LIVE_GAME_PINS.map((pin) => resolveLiveGame(pin, options))
  );
  const games = resolved
    .filter(
      (result): result is PromiseFulfilledResult<ResolvedLiveGame> => result.status === 'fulfilled'
    )
    .map((result) => result.value.item);

  if (games.length === 0 && resolved.some((result) => result.status === 'rejected')) {
    throw new LiveCatalogError('source-unavailable', 'No pinned production game is available.');
  }

  const query = parsedInput.query?.toLowerCase();
  const matchingGames = query
    ? games.filter((game) =>
        [game.title, game.creatorName, game.description, game.taskDescription, ...game.tags]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(query))
      )
    : games;

  return {
    games: matchingGames.slice(0, parsedInput.limit),
    nextCursor: null,
  };
}

export async function getLiveGameDetail(
  slug: string,
  options: LiveCatalogDependencies = {}
): Promise<GameDetailResponse | null> {
  const parsed = GameGetInputSchema.safeParse({ slug });
  if (!parsed.success) return null;
  const pin = pinForSlug(parsed.data.slug);
  if (!pin) return null;

  const resolvedDependencies = dependencies(options);
  const game = await resolveLiveGame(pin, options);
  const now = resolvedDependencies.now();
  return {
    ...game.item,
    artifactUrl: new URL(
      `/api/games/${encodeURIComponent(pin.slug)}/artifact`,
      `${resolvedDependencies.siteUrl.replace(/\/+$/, '')}/`
    ).toString(),
    artifactUrlExpiresAt: new Date(now.getTime() + PROXY_DELIVERY_TTL_MS).toISOString(),
    source: {
      artifactId: pin.source.artifactId,
      artifactKeccak256Hash: pin.source.artifactKeccak256Hash,
      artifactMimeType: pin.source.artifactMimeType,
      artifactSha256Hash: pin.source.artifactSha256Hash,
      artifactSizeBytes: pin.source.artifactSizeBytes,
      submissionId: pin.source.submissionId,
      taskId: pin.source.taskId,
    },
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
    throw new LiveCatalogError('source-invalid', 'The production artifact exceeds the size limit.');
  }
  if (!response.body) {
    throw new LiveCatalogError('source-unavailable', 'The production artifact has no body.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let complete = false;
  while (!complete) {
    const next = await reader.read();
    complete = next.done;
    if (next.done) continue;
    if (!next.value) continue;
    byteLength += next.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LiveCatalogError(
        'source-invalid',
        'The production artifact exceeds the size limit.'
      );
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function getLiveGameArtifact(
  slug: string,
  options: LiveCatalogDependencies = {}
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const parsed = GameGetInputSchema.safeParse({ slug });
  if (!parsed.success) return null;
  const pin = pinForSlug(parsed.data.slug);
  if (!pin) return null;

  const resolvedDependencies = dependencies(options);
  const resolved = await resolveLiveGame(pin, options);
  let response: Response;
  try {
    response = await resolvedDependencies.fetcher(resolved.artifactUrl, {
      cache: 'no-store',
      headers: { accept: 'text/html,application/octet-stream' },
      signal: AbortSignal.timeout(LIVE_SOURCE_TIMEOUT_MS),
    });
  } catch {
    throw new LiveCatalogError(
      'source-unavailable',
      'The production artifact could not be fetched.'
    );
  }
  if (!response.ok) {
    throw new LiveCatalogError(
      'source-unavailable',
      `The production artifact returned HTTP ${response.status}.`
    );
  }

  const bytes = await readBoundedBody(response, MAX_INTERACTIVE_HTML_BYTES);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (
    bytes.byteLength !== pin.source.artifactSizeBytes ||
    sha256 !== pin.source.artifactSha256Hash
  ) {
    throw new LiveCatalogError(
      'integrity',
      'The production artifact bytes do not match their pin.'
    );
  }

  return { bytes, fileName: pin.source.fileName };
}

export function clearLiveCatalogCacheForTests(): void {
  resolutionCache.clear();
}
