import { logger } from './logger';

// Slap-Chop is intentionally observable without becoming a second identity or content store.
// These events use only bounded operational dimensions. In particular, never add request input,
// storage locations, presigned URLs, Privy IDs, IP addresses, bearer tokens, or game bytes here.

export type SlapChopArtifactOperation =
  | 'catalog_artifact'
  | 'catalog_cover'
  | 'curation_artifact'
  | 'unspecified';

export type SlapChopHttpOperation =
  | 'catalog_detail'
  | 'catalog_list'
  | 'curation'
  | 'curation_rpc'
  | 'games_rpc'
  | 'games_invalid'
  | 'vote';

export type SlapChopCurationFailureReason =
  | 'conflict'
  | 'forbidden'
  | 'internal'
  | 'invalid'
  | 'not_found'
  | 'precondition_failed'
  | 'unauthorized';

export type SlapChopVoteFailureReason =
  | 'internal'
  | 'not_found'
  | 'rate_limit_unavailable'
  | 'rate_limited'
  | 'unauthorized';

function boundedDurationMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function requestMethod(value: string): 'GET' | 'POST' | 'other' {
  if (value === 'GET' || value === 'POST') return value;
  return 'other';
}

function statusFamily(value: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (value >= 200 && value < 300) return '2xx';
  if (value >= 300 && value < 400) return '3xx';
  if (value >= 400 && value < 500) return '4xx';
  if (value >= 500 && value < 600) return '5xx';
  return 'other';
}

export function slapChopDurationMs(startedAt: number): number {
  return boundedDurationMs(performance.now() - startedAt);
}

// This classifier deliberately receives a path without query parameters and yields only fixed
// labels. It is shared by the app middleware and Morgan's skip predicate so the generic access
// log never separately records a search term, slug, user ID, or client address for these routes.
export function classifySlapChopHttpOperation(path: string): SlapChopHttpOperation | null {
  const normalizedPath = path.replace(/\/+$/, '') || '/';

  if (normalizedPath.startsWith('/trpc/gameCuration.')) return 'curation_rpc';
  if (normalizedPath.startsWith('/trpc/games.')) return 'games_rpc';
  if (normalizedPath === '/api/games') return 'catalog_list';
  if (
    normalizedPath === '/api/games/curation' ||
    normalizedPath.startsWith('/api/games/curation/')
  ) {
    return 'curation';
  }
  if (/^\/api\/games\/[^/]+\/vote$/.test(normalizedPath)) return 'vote';
  if (/^\/api\/games\/[^/]+$/.test(normalizedPath)) return 'catalog_detail';
  if (normalizedPath.startsWith('/api/games')) return 'games_invalid';
  return null;
}

export function logSlapChopHttpRequest(input: {
  durationMs: number;
  method: string;
  operation: SlapChopHttpOperation;
  statusCode: number;
}): void {
  logger.info('slap_chop.http', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.http',
    method: requestMethod(input.method),
    operation: input.operation,
    outcome: 'completed',
    statusFamily: statusFamily(input.statusCode),
  });
}

export function logSlapChopCatalogRead(input: {
  artifactDeliveryUnavailableCount: number;
  durationMs: number;
  hasCursor: boolean;
  hasMore: boolean;
  hasSearchQuery: boolean;
  operation: 'get' | 'list';
  outcome: 'failure' | 'not_found' | 'success';
  rankingMode?: 'hot' | 'new';
  resultCount: number;
}): void {
  logger.info('slap_chop.catalog_read', {
    artifactDeliveryUnavailableCount: boundedCount(input.artifactDeliveryUnavailableCount),
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.catalog_read',
    hasCursor: input.hasCursor,
    hasMore: input.hasMore,
    hasSearchQuery: input.hasSearchQuery,
    operation: input.operation,
    outcome: input.outcome,
    rankingMode: input.rankingMode,
    resultCount: boundedCount(input.resultCount),
  });
}

export function logSlapChopArtifactDeliveryFailure(input: {
  durationMs: number;
  operation: SlapChopArtifactOperation;
  reason: 'presign_failed' | 'source_pin_mismatch';
}): void {
  logger.warn('slap_chop.artifact_delivery_failure', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.artifact_delivery_failure',
    operation: input.operation,
    outcome: 'failure',
    reason: input.reason,
  });
}

export function logSlapChopVote(input: {
  durationMs: number;
  requestedVote: 'down' | 'up';
  selectedVote: 'cleared' | 'down' | 'up';
}): void {
  logger.info('slap_chop.vote', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.vote',
    operation: 'set_vote',
    outcome: 'success',
    requestedVote: input.requestedVote,
    selectedVote: input.selectedVote,
  });
}

export function logSlapChopVoteFailure(input: {
  durationMs: number;
  reason: SlapChopVoteFailureReason;
}): void {
  logger.warn('slap_chop.vote_failure', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.vote_failure',
    operation: 'set_vote',
    outcome: 'failure',
    reason: input.reason,
  });
}

export function logSlapChopVoteState(input: { durationMs: number }): void {
  logger.info('slap_chop.vote_state', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.vote_state',
    operation: 'get_vote_state',
    outcome: 'success',
  });
}

export function logSlapChopVoteStateFailure(input: {
  durationMs: number;
  reason: SlapChopVoteFailureReason;
}): void {
  logger.warn('slap_chop.vote_state_failure', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.vote_state_failure',
    operation: 'get_vote_state',
    outcome: 'failure',
    reason: input.reason,
  });
}

export function logSlapChopCuration(input: {
  artifactCount: number;
  durationMs: number;
  operation: 'hide' | 'publish' | 'resolve_task' | 'save_draft';
  result: 'draft' | 'eligible' | 'hidden' | 'ineligible' | 'published';
}): void {
  logger.info('slap_chop.curation', {
    artifactCount: boundedCount(input.artifactCount),
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.curation',
    operation: input.operation,
    outcome: 'success',
    result: input.result,
  });
}

export function logSlapChopCurationFailure(input: {
  durationMs: number;
  operation: 'hide' | 'publish' | 'resolve_task' | 'save_draft';
  reason: SlapChopCurationFailureReason;
}): void {
  logger.warn('slap_chop.curation_failure', {
    durationMs: boundedDurationMs(input.durationMs),
    event: 'slap_chop.curation_failure',
    operation: input.operation,
    outcome: 'failure',
    reason: input.reason,
  });
}
