// Verifies: ADR-0087 and ADR-0088
import type {
  GameCurationGame,
  GameCurationResolvedTask,
  GameCurationMutationResponse,
} from '@taskmarket/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CurationApiError, type CurationApi } from '@/lib/curation-api';

const previewButtonLabel = 'Mark production preview verified';

vi.mock('./curator-artifact-preview', () => ({
  CuratorArtifactPreview: ({
    artifact,
    onOutcomeChange,
  }: {
    artifact: { sha256Hash: string } | null;
    onOutcomeChange: (outcome: unknown) => void;
  }) =>
    artifact ? (
      <button
        onClick={() =>
          onOutcomeChange({
            byteLength: 42,
            document: '<!doctype html><html><body>Verified</body></html>',
            kind: 'ready',
            sha256: artifact.sha256Hash,
          })
        }
        type="button"
      >
        {previewButtonLabel}
      </button>
    ) : (
      <p>Preview needs a selected artifact.</p>
    ),
}));

import { CurationWorkspace, type CuratorAuth } from './curation-workspace';

const taskId = 'task-curation-1';
const submissionId = 'submission-curation-1';
const artifactId = 'artifact-curation-1';

const resolution: GameCurationResolvedTask = {
  eligible: true,
  eligibilityReason: null,
  submissions: [
    {
      artifacts: [
        {
          fileName: 'verified-game.html',
          id: artifactId,
          keccak256Hash: `0x${'1'.repeat(64)}`,
          mimeType: 'text/html',
          previewUrl: 'https://files.taskmarket.dev/verified-game.html',
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
    description: 'Build a verified game.',
    id: taskId,
    status: 'completed',
    tags: ['arcade'],
  },
};

function curationGame(overrides: Partial<GameCurationGame> = {}): GameCurationGame {
  return {
    artifactId,
    artifactKeccak256Hash: `0x${'1'.repeat(64)}`,
    artifactMimeType: 'text/html',
    artifactSha256Hash: 'a'.repeat(64),
    artifactSizeBytes: 42,
    coverAltText: 'A square cover for the verified game.',
    coverArtifactId: null,
    coverHeight: 64,
    coverMimeType: 'image/png',
    coverSha256Hash: 'b'.repeat(64),
    coverSource: 'catalog_asset',
    coverWidth: 64,
    createdAt: '2026-08-16T00:00:00.000Z',
    creatorName: 'Arcade Builder',
    description: 'A verified game.',
    hiddenAt: null,
    id: 'game-curation-1',
    previewedAt: '2026-08-16T00:01:00.000Z',
    publishedAt: null,
    slug: 'verified-game',
    status: 'draft',
    submissionId,
    tags: ['arcade'],
    taskId,
    title: 'Verified game',
    updatedAt: '2026-08-16T00:01:00.000Z',
    ...overrides,
  };
}

function mutation(game: GameCurationGame): GameCurationMutationResponse {
  return { game };
}

function defaultAuth(overrides: Partial<CuratorAuth> = {}): CuratorAuth {
  return {
    authenticated: true,
    configured: true,
    getAccessToken: vi.fn().mockResolvedValue('privy-token'),
    login: vi.fn(),
    ready: true,
    ...overrides,
  };
}

function defaultApi(overrides: Partial<CurationApi> = {}): CurationApi {
  return {
    hide: vi.fn(),
    publish: vi.fn(),
    resolveTask: vi.fn().mockResolvedValue(resolution),
    upsert: vi.fn().mockResolvedValue(mutation(curationGame())),
    ...overrides,
  };
}

async function resolveAndReview() {
  fireEvent.change(screen.getByLabelText('Task URL or ID'), { target: { value: taskId } });
  fireEvent.click(screen.getByRole('button', { name: 'Resolve task' }));

  await screen.findByRole('radio', { name: /verified-game.html/i });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resolve task' })).toBeEnabled());
  const artifactRadio = screen.getByRole('radio', { name: /verified-game.html/i });
  expect(artifactRadio).toBeEnabled();
  fireEvent.click(artifactRadio);
  await waitFor(() => expect(artifactRadio).toBeChecked());
  await screen.findByLabelText(/^Title/);
  fireEvent.click(screen.getByRole('button', { name: previewButtonLabel }));
}

describe('CurationWorkspace', () => {
  it('fails closed for an anonymous session without rendering curator controls', () => {
    const login = vi.fn();
    render(
      <CurationWorkspace api={defaultApi()} auth={defaultAuth({ authenticated: false, login })} />
    );

    expect(screen.getByRole('heading', { name: 'Curator sign-in required' })).toBeVisible();
    expect(screen.queryByLabelText('Task URL or ID')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to curate' }));
    expect(login).toHaveBeenCalledOnce();
  });

  it('clears the workspace and denies a signed-in identity rejected by the server allowlist', async () => {
    const api = defaultApi({
      resolveTask: vi
        .fn()
        .mockRejectedValue(
          new CurationApiError('unauthorized', 'Curator access is not authorized', 403)
        ),
    });
    render(<CurationWorkspace api={api} auth={defaultAuth()} />);

    fireEvent.change(screen.getByLabelText('Task URL or ID'), { target: { value: taskId } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve task' }));

    expect(await screen.findByRole('heading', { name: 'Curator access denied' })).toBeVisible();
    expect(screen.queryByText('Build a verified game.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Task URL or ID')).not.toBeInTheDocument();
  });

  it('pins a reviewed source through draft, publish, hide, and re-publication confirmations', async () => {
    const draft = curationGame();
    const published = curationGame({
      publishedAt: '2026-08-16T00:02:00.000Z',
      status: 'published',
      updatedAt: '2026-08-16T00:02:00.000Z',
    });
    const hidden = curationGame({
      hiddenAt: '2026-08-16T00:03:00.000Z',
      publishedAt: '2026-08-16T00:02:00.000Z',
      status: 'hidden',
      updatedAt: '2026-08-16T00:03:00.000Z',
    });
    const api = defaultApi({
      hide: vi.fn().mockResolvedValue(mutation(hidden)),
      publish: vi.fn().mockResolvedValue(mutation(published)),
      upsert: vi.fn().mockResolvedValue(mutation(draft)),
    });
    render(<CurationWorkspace api={api} auth={defaultAuth()} />);

    await resolveAndReview();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Verified game' } });
    fireEvent.change(screen.getByLabelText(/^Unique slug/), { target: { value: 'verified-game' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(api.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId,
          previewed: true,
          submissionId,
          taskId,
        }),
        'privy-token'
      )
    );
    expect(await screen.findByText('Draft saved')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }));
    expect(screen.getByText('Confirm publication')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish game' }));
    await screen.findByText('Game published');

    fireEvent.click(screen.getByRole('button', { name: 'Hide from catalog' }));
    expect(screen.getByText('Confirm hide')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide game' }));
    await screen.findByText('Game hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Review re-publication' }));
    expect(screen.getByText('Confirm re-publication')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Re-publish game' }));
    expect(await screen.findByText('Game republished')).toBeVisible();
  });
});
