import { beforeEach, describe, expect, it, vi } from 'vitest';

const { info, warn } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { info, warn },
}));

import {
  classifySlapChopHttpOperation,
  logSlapChopArtifactDeliveryFailure,
  logSlapChopCatalogRead,
  logSlapChopCuration,
  logSlapChopCurationFailure,
  logSlapChopHttpRequest,
  logSlapChopVote,
  logSlapChopVoteFailure,
  logSlapChopVoteState,
  logSlapChopVoteStateFailure,
} from '../../../src/lib/slap-chop-observability';

describe('Slap-Chop observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces Slap-Chop request paths with bounded HTTP operation labels', () => {
    expect(classifySlapChopHttpOperation('/api/games')).toBe('catalog_list');
    expect(classifySlapChopHttpOperation('/api/games/private-slug')).toBe('catalog_detail');
    expect(classifySlapChopHttpOperation('/api/games/private-game/vote')).toBe('vote');
    expect(classifySlapChopHttpOperation('/api/games/curation/tasks')).toBe('curation');
    expect(classifySlapChopHttpOperation('/trpc/games.vote')).toBe('games_rpc');
    expect(classifySlapChopHttpOperation('/trpc/gameCuration.publish')).toBe('curation_rpc');
    expect(classifySlapChopHttpOperation('/api/games%2Fprivate')).toBe('games_invalid');
    expect(classifySlapChopHttpOperation('/api/tasks/private-task')).toBeNull();
  });

  it('emits a bounded HTTP event without the original request path or client data', () => {
    logSlapChopHttpRequest({
      clientAddress: '203.0.113.10',
      durationMs: 12.7,
      method: 'DELETE',
      operation: 'catalog_detail',
      path: '/api/games/private-slug?query=private-search',
      statusCode: 404,
    } as never);

    expect(info).toHaveBeenCalledWith('slap_chop.http', {
      durationMs: 13,
      event: 'slap_chop.http',
      method: 'other',
      operation: 'catalog_detail',
      outcome: 'completed',
      statusFamily: '4xx',
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain('private-slug');
    expect(serialized).not.toContain('private-search');
    expect(serialized).not.toContain('203.0.113.10');
  });

  it('emits bounded catalog dimensions without the raw search input', () => {
    logSlapChopCatalogRead({
      artifactDeliveryUnavailableCount: 1,
      durationMs: 12.7,
      hasCursor: true,
      hasMore: false,
      hasSearchQuery: true,
      operation: 'list',
      outcome: 'success',
      query: 'private search terms must not reach logs',
      rankingMode: 'hot',
      resultCount: 3,
    } as never);

    expect(info).toHaveBeenCalledWith('slap_chop.catalog_read', {
      artifactDeliveryUnavailableCount: 1,
      durationMs: 13,
      event: 'slap_chop.catalog_read',
      hasCursor: true,
      hasMore: false,
      hasSearchQuery: true,
      operation: 'list',
      outcome: 'success',
      rankingMode: 'hot',
      resultCount: 3,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('private search terms');
  });

  it('emits artifact failures without storage identifiers or delivery URLs', () => {
    logSlapChopArtifactDeliveryFailure({
      durationMs: 4,
      operation: 'catalog_artifact',
      reason: 'source_pin_mismatch',
      storageUri: 's3://private-bucket/immutable-game.html',
      url: 'https://storage.example.test/signed-object?signature=secret',
    } as never);

    expect(warn).toHaveBeenCalledWith('slap_chop.artifact_delivery_failure', {
      durationMs: 4,
      event: 'slap_chop.artifact_delivery_failure',
      operation: 'catalog_artifact',
      outcome: 'failure',
      reason: 'source_pin_mismatch',
    });
    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain('private-bucket');
    expect(serialized).not.toContain('signature=secret');
  });

  it('does not retain voter identity, client address, or authorization in vote events', () => {
    logSlapChopVote({
      authorization: 'Bearer private-token',
      clientAddress: '203.0.113.10',
      durationMs: 8,
      privyUserId: 'did:privy:voter-private',
      requestedVote: 'up',
      selectedVote: 'up',
    } as never);
    logSlapChopVoteFailure({
      durationMs: 9,
      reason: 'rate_limited',
      privyUserId: 'did:privy:voter-private',
    } as never);

    expect(info).toHaveBeenCalledWith('slap_chop.vote', {
      durationMs: 8,
      event: 'slap_chop.vote',
      operation: 'set_vote',
      outcome: 'success',
      requestedVote: 'up',
      selectedVote: 'up',
    });
    expect(warn).toHaveBeenCalledWith('slap_chop.vote_failure', {
      durationMs: 9,
      event: 'slap_chop.vote_failure',
      operation: 'set_vote',
      outcome: 'failure',
      reason: 'rate_limited',
    });
    const serialized = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(serialized).not.toContain('did:privy:voter-private');
    expect(serialized).not.toContain('203.0.113.10');
    expect(serialized).not.toContain('private-token');
  });

  it('does not attach a selected vote to an authenticated vote-state read', () => {
    logSlapChopVoteState({
      durationMs: 10,
      privyUserId: 'did:privy:voter-private',
      selectedVote: 'up',
    } as never);
    logSlapChopVoteStateFailure({
      durationMs: 11,
      reason: 'unauthorized',
      authorization: 'Bearer private-token',
    } as never);

    expect(info).toHaveBeenCalledWith('slap_chop.vote_state', {
      durationMs: 10,
      event: 'slap_chop.vote_state',
      operation: 'get_vote_state',
      outcome: 'success',
    });
    expect(warn).toHaveBeenCalledWith('slap_chop.vote_state_failure', {
      durationMs: 11,
      event: 'slap_chop.vote_state_failure',
      operation: 'get_vote_state',
      outcome: 'failure',
      reason: 'unauthorized',
    });
    const serialized = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(serialized).not.toContain('did:privy:voter-private');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('selectedVote');
  });

  it('records only an operation result or a bounded failure reason for curation', () => {
    logSlapChopCuration({
      artifactCount: 2,
      durationMs: 10,
      operation: 'resolve_task',
      result: 'eligible',
      taskReference: 'https://taskmarket.dev/tasks/private-task',
    } as never);
    logSlapChopCurationFailure({
      durationMs: 11,
      operation: 'publish',
      reason: 'precondition_failed',
      userId: 'did:privy:curator-private',
    } as never);

    expect(info).toHaveBeenCalledWith('slap_chop.curation', {
      artifactCount: 2,
      durationMs: 10,
      event: 'slap_chop.curation',
      operation: 'resolve_task',
      outcome: 'success',
      result: 'eligible',
    });
    expect(warn).toHaveBeenCalledWith('slap_chop.curation_failure', {
      durationMs: 11,
      event: 'slap_chop.curation_failure',
      operation: 'publish',
      outcome: 'failure',
      reason: 'precondition_failed',
    });
    const serialized = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(serialized).not.toContain('private-task');
    expect(serialized).not.toContain('curator-private');
  });
});
