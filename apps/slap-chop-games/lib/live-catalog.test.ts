import { describe, expect, it, vi } from 'vitest';

import {
  getLiveGameArtifact,
  getLiveGameDetail,
  LIVE_GAME_PINS,
  listLiveCatalog,
} from './live-catalog';

// Verifies: ADR-0091

const pin = LIVE_GAME_PINS[0]!;
const sourceApiUrl = 'https://api.taskmarket.test';
const siteUrl = 'https://games-dev.taskmarket.test';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

function taskResponse() {
  return {
    description: 'Build a playable coin-op tie-in for an imaginary film.',
    id: pin.source.taskId,
    primaryAward: { workerAddress: pin.source.workerAddress.toUpperCase() },
    status: 'completed',
    submissionVisibility: 'public',
    tags: ['game'],
    taskVisibility: 'public',
  };
}

function submissionResponse() {
  return [
    {
      artifacts: [
        {
          fileName: pin.source.fileName,
          id: pin.source.artifactId,
          keccak256Hash: pin.source.artifactKeccak256Hash,
          mimeType: pin.source.artifactMimeType,
          previewExpiresAt: '2099-08-16T12:00:00.000Z',
          previewUrl: `https://${pin.source.artifactHost}/pinned-game`,
          role: pin.source.artifactRole,
          sha256Hash: pin.source.artifactSha256Hash,
          sizeBytes: pin.source.artifactSizeBytes,
        },
      ],
      id: pin.source.submissionId,
      rejectedAt: null,
      workerAddress: pin.source.workerAddress,
    },
  ];
}

function sourceFetcher(options?: { submissions?: unknown }) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/submissions')) {
      expect(url.searchParams.get('includePreviewUrls')).toBe('media');
      return jsonResponse(options?.submissions ?? submissionResponse());
    }
    return jsonResponse(taskResponse());
  });
}

describe('live production catalog source', () => {
  it('turns an exact accepted production pin into the existing game detail contract', async () => {
    const result = await getLiveGameDetail(pin.slug, {
      fetcher: sourceFetcher(),
      now: () => new Date('2026-08-16T10:00:00.000Z'),
      siteUrl,
      sourceApiUrl,
    });

    expect(result).toMatchObject({
      artifactUrl: `${siteUrl}/api/games/${pin.slug}/artifact`,
      artifactUrlExpiresAt: '2026-08-16T10:05:00.000Z',
      coverUrl: `${siteUrl}${pin.coverPath}`,
      slug: pin.slug,
      source: {
        artifactId: pin.source.artifactId,
        artifactSha256Hash: pin.source.artifactSha256Hash,
        submissionId: pin.source.submissionId,
        taskId: pin.source.taskId,
      },
    });
  });

  it('resolves the exact pinned submission when an awarded worker has multiple submissions', async () => {
    const duplicate = {
      ...submissionResponse()[0],
      id: 'another-active-submission',
    };

    await expect(
      getLiveGameDetail(pin.slug, {
        fetcher: sourceFetcher({ submissions: [...submissionResponse(), duplicate] }),
        siteUrl,
        sourceApiUrl,
      })
    ).resolves.toMatchObject({
      slug: pin.slug,
      source: { submissionId: pin.source.submissionId },
    });
  });

  it('fails closed when the exact pinned submission is no longer present', async () => {
    const replacement = {
      ...submissionResponse()[0],
      id: 'replacement-submission',
    };

    await expect(
      getLiveGameDetail(pin.slug, {
        fetcher: sourceFetcher({ submissions: [replacement] }),
        siteUrl,
        sourceApiUrl,
      })
    ).rejects.toMatchObject({
      kind: 'source-invalid',
      message: expect.stringContaining('exact pinned awarded submission'),
    });
  });

  it('rejects expired or unpinned production delivery URLs before proxying bytes', async () => {
    const expiredSubmission = submissionResponse();
    expiredSubmission[0]!.artifacts[0]!.previewExpiresAt = '2026-08-16T09:59:59.000Z';

    await expect(
      getLiveGameDetail(pin.slug, {
        fetcher: sourceFetcher({ submissions: expiredSubmission }),
        now: () => new Date('2026-08-16T10:00:00.000Z'),
        siteUrl,
        sourceApiUrl,
      })
    ).rejects.toMatchObject({ kind: 'source-unavailable' });

    const unexpectedHostSubmission = submissionResponse();
    unexpectedHostSubmission[0]!.artifacts[0]!.previewUrl =
      'https://unexpected.example/pinned-game';

    await expect(
      getLiveGameDetail(pin.slug, {
        fetcher: sourceFetcher({ submissions: unexpectedHostSubmission }),
        siteUrl,
        sourceApiUrl,
      })
    ).rejects.toMatchObject({ kind: 'source-invalid' });
  });

  it('returns no detail for a slug outside the reviewed allowlist', async () => {
    await expect(getLiveGameDetail('not-curated')).resolves.toBeNull();
  });

  it('keeps a partially unavailable allowlist usable but fails when every pin is unavailable', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(input);
      if (url.pathname.includes(LIVE_GAME_PINS[1]!.source.taskId)) {
        return new Response('', { status: 503 });
      }
      if (url.pathname.endsWith('/submissions')) return jsonResponse(submissionResponse());
      return jsonResponse(taskResponse());
    });

    await expect(
      listLiveCatalog(
        { limit: 48 },
        {
          fetcher,
          siteUrl,
          sourceApiUrl,
        }
      )
    ).resolves.toMatchObject({ games: [{ slug: pin.slug }], nextCursor: null });

    await expect(
      listLiveCatalog(
        { limit: 48 },
        {
          fetcher: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
          siteUrl,
          sourceApiUrl,
        }
      )
    ).rejects.toMatchObject({ kind: 'source-unavailable' });
  });

  it('refuses artifact bytes that do not match the reviewed SHA-256 pin', async () => {
    const fetcher = sourceFetcher();
    fetcher.mockImplementation(async (input: string | URL) => {
      const url = new URL(input);
      if (url.hostname === pin.source.artifactHost) {
        return new Response('<!doctype html><title>tampered</title>');
      }
      if (url.pathname.endsWith('/submissions')) return jsonResponse(submissionResponse());
      return jsonResponse(taskResponse());
    });

    await expect(
      getLiveGameArtifact(pin.slug, {
        fetcher,
        siteUrl,
        sourceApiUrl,
      })
    ).rejects.toMatchObject({ kind: 'integrity' });
  });
});
