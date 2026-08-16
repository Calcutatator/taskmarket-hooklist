import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  logSlapChopCuration,
  logSlapChopCurationFailure,
  requireSlapChopCurator,
  resolveTaskForGameCuration,
} = vi.hoisted(() => ({
  logSlapChopCuration: vi.fn(),
  logSlapChopCurationFailure: vi.fn(),
  requireSlapChopCurator: vi.fn(),
  resolveTaskForGameCuration: vi.fn(),
}));

vi.mock('../../../src/lib/slap-chop-curator-auth', () => ({ requireSlapChopCurator }));
vi.mock('../../../src/lib/slap-chop-observability', () => ({
  logSlapChopCuration,
  logSlapChopCurationFailure,
  slapChopDurationMs: vi.fn().mockReturnValue(6),
}));
vi.mock('../../../src/services/game-curation', () => {
  class GameCurationError extends Error {
    constructor(
      readonly code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND' | 'PRECONDITION_FAILED',
      message: string
    ) {
      super(message);
    }
  }

  return {
    GameCurationError,
    hideGameCuration: vi.fn(),
    publishGameCuration: vi.fn(),
    resolveTaskForGameCuration,
    serializeCurationGame: vi.fn(),
    upsertGameCuration: vi.fn(),
  };
});

import { gameCurationRouter } from '../../../src/routers/game-curation.router';

function caller() {
  return gameCurationRouter.createCaller({
    db: {} as never,
    req: { headers: { authorization: 'Bearer private-token' } } as never,
    res: { locals: {} } as never,
    caller: undefined,
    idempotencyKey: undefined,
    taskAccessGrant: undefined,
  });
}

describe('game curation router observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSlapChopCurator).mockResolvedValue('did:privy:curator-private');
  });

  it('records an eligible resolution with aggregate counts and no task reference', async () => {
    vi.mocked(resolveTaskForGameCuration).mockResolvedValue({
      eligibilityReason: null,
      eligible: true,
      submissions: [
        {
          artifacts: [
            {
              fileName: 'game-a.html',
              id: 'artifact-1',
              keccak256Hash: `0x${'a'.repeat(64)}`,
              mimeType: 'text/html',
              previewUrl: 'https://delivery.example.test/game-a.html',
              previewUrlExpiresAt: '2026-08-16T00:05:00.000Z',
              role: 'final',
              sha256Hash: 'b'.repeat(64),
              sizeBytes: 64,
            },
            {
              fileName: 'game-b.html',
              id: 'artifact-2',
              keccak256Hash: `0x${'c'.repeat(64)}`,
              mimeType: 'text/html',
              previewUrl: 'https://delivery.example.test/game-b.html',
              previewUrlExpiresAt: '2026-08-16T00:05:00.000Z',
              role: 'preview',
              sha256Hash: 'd'.repeat(64),
              sizeBytes: 64,
            },
          ],
          id: 'submission-1',
          submittedAt: '2026-08-16T00:00:00.000Z',
          workerAddress: '0x1111111111111111111111111111111111111111',
        },
      ],
      task: { description: 'A private description', id: 'task-1', status: 'completed', tags: [] },
    } as never);

    await expect(caller().resolveTask({ reference: 'task-1' })).resolves.toMatchObject({
      eligible: true,
    });

    expect(logSlapChopCuration).toHaveBeenCalledWith({
      artifactCount: 2,
      durationMs: 6,
      operation: 'resolve_task',
      result: 'eligible',
    });
    expect(JSON.stringify(logSlapChopCuration.mock.calls)).not.toContain('task-1');
    expect(JSON.stringify(logSlapChopCuration.mock.calls)).not.toContain('private description');
  });

  it('records a bounded authorization failure before denying curator access', async () => {
    vi.mocked(requireSlapChopCurator).mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN', message: 'Curator access is not authorized' })
    );

    await expect(caller().resolveTask({ reference: 'task-1' })).rejects.toThrow(
      'Curator access is not authorized'
    );

    expect(logSlapChopCurationFailure).toHaveBeenCalledWith({
      durationMs: 6,
      operation: 'resolve_task',
      reason: 'forbidden',
    });
  });
});
