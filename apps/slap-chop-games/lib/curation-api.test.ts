// Verifies: ADR-0087 and ADR-0088
import { describe, expect, it, vi } from 'vitest';

import { CurationApiError, createCurationApi } from './curation-api';

const taskId = 'task-curation-1';
const artifactId = 'artifact-curation-1';
const submissionId = 'submission-curation-1';

const resolvedTask = {
  eligible: true,
  eligibilityReason: null,
  submissions: [
    {
      artifacts: [
        {
          fileName: 'game.html',
          id: artifactId,
          keccak256Hash: `0x${'1'.repeat(64)}`,
          mimeType: 'text/html',
          previewUrl: 'https://files.taskmarket.dev/game.html',
          previewUrlExpiresAt: '2026-08-16T01:00:00.000Z',
          role: 'final',
          sha256Hash: 'a'.repeat(64),
          sizeBytes: 42,
        },
      ],
      id: submissionId,
      submittedAt: '2026-08-16T00:00:00.000Z',
      workerAddress: '0x1111111111111111111111111111111111111111',
    },
  ],
  task: {
    description: 'Build a game.',
    id: taskId,
    status: 'completed',
    tags: ['arcade'],
  },
};

describe('curation API transport', () => {
  it('uses the app-relative curation route with a Privy bearer and validates the resolved pin', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(resolvedTask), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    );
    const api = createCurationApi({ apiBaseUrl: 'https://games.example.test', fetcher });

    await expect(
      api.resolveTask(`https://taskmarket.dev/tasks/${taskId}`, 'privy-token')
    ).resolves.toEqual(resolvedTask);

    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        `/api/games/curation/tasks?reference=${encodeURIComponent(
          `https://taskmarket.dev/tasks/${taskId}`
        )}`,
        'https://games.example.test'
      ),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer privy-token' }),
        method: 'GET',
      })
    );
  });

  it('maps an invalid bearer and a non-allowlisted bearer into distinct fail-closed states', async () => {
    const expired = createCurationApi({
      apiBaseUrl: 'https://games.example.test',
      fetcher: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'A valid Privy access token is required' }), {
          headers: { 'content-type': 'application/json' },
          status: 401,
        })
      ),
    });
    const denied = createCurationApi({
      apiBaseUrl: 'https://games.example.test',
      fetcher: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Curator access is not authorized' } }), {
          headers: { 'content-type': 'application/json' },
          status: 403,
        })
      ),
    });

    await expect(expired.resolveTask(taskId, 'expired-token')).rejects.toMatchObject({
      kind: 'expired-session',
      status: 401,
    } satisfies Partial<CurationApiError>);
    await expect(denied.resolveTask(taskId, 'other-user-token')).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 403,
    } satisfies Partial<CurationApiError>);
  });

  it('maps deterministic curation conflicts without exposing a storage implementation', async () => {
    const api = createCurationApi({
      apiBaseUrl: 'https://games.example.test',
      fetcher: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'A game already uses this slug' }), {
          headers: { 'content-type': 'application/json' },
          status: 409,
        })
      ),
    });

    await expect(
      api.upsert(
        {
          artifactId,
          cover: null,
          previewed: false,
          slug: 'verified-game',
          submissionId,
          tags: ['arcade'],
          taskId,
          title: 'Verified game',
        },
        'privy-token'
      )
    ).rejects.toMatchObject({
      kind: 'conflict',
      message: 'A game already uses this slug',
      status: 409,
    } satisfies Partial<CurationApiError>);
  });
});
