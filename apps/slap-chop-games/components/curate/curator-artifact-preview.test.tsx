// Verifies: ADR-0087 and ADR-0088
import type { GameCurationArtifact } from '@taskmarket/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadInteractiveHtmlRuntime } = vi.hoisted(() => ({
  loadInteractiveHtmlRuntime: vi.fn(),
}));

vi.mock('@taskmarket/html-sandbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@taskmarket/html-sandbox')>();
  return { ...actual, loadInteractiveHtmlRuntime };
});

import {
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_REFERRER_POLICY,
} from '@taskmarket/html-sandbox';

import { CuratorArtifactPreview } from './curator-artifact-preview';

const artifact: GameCurationArtifact = {
  fileName: 'game.html',
  id: 'artifact-1',
  keccak256Hash: `0x${'1'.repeat(64)}`,
  mimeType: 'text/html',
  previewUrl: 'https://files.taskmarket.dev/artifact-1.html',
  previewUrlExpiresAt: '2026-08-16T01:00:00.000Z',
  role: 'final',
  sha256Hash: 'a'.repeat(64),
  sizeBytes: 128,
};

describe('CuratorArtifactPreview', () => {
  beforeEach(() => {
    loadInteractiveHtmlRuntime.mockReset();
  });

  it('loads the selected immutable pin through the same closed production sandbox', async () => {
    loadInteractiveHtmlRuntime.mockResolvedValue({
      byteLength: 128,
      document: '<!doctype html><html><body>Reviewed game</body></html>',
      kind: 'ready',
      sha256: artifact.sha256Hash,
    });
    const onOutcomeChange = vi.fn();

    render(<CuratorArtifactPreview artifact={artifact} onOutcomeChange={onOutcomeChange} />);

    const iframe = await screen.findByTitle('Curator preview of game.html');

    expect(loadInteractiveHtmlRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: {
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
        expectedSha256: artifact.sha256Hash,
        source: { getUrl: expect.any(Function) },
      })
    );
    expect(iframe).toHaveAttribute('sandbox', INTERACTIVE_HTML_IFRAME_SANDBOX);
    expect(iframe).toHaveAttribute('allow', INTERACTIVE_HTML_IFRAME_ALLOW);
    expect(iframe).toHaveAttribute('referrerpolicy', INTERACTIVE_HTML_REFERRER_POLICY);
    await waitFor(() =>
      expect(onOutcomeChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'ready', sha256: artifact.sha256Hash })
      )
    );
  });

  it('fails closed when the shared runtime reports an integrity mismatch', async () => {
    loadInteractiveHtmlRuntime.mockResolvedValue({
      actualSha256: 'b'.repeat(64),
      expectedSha256: artifact.sha256Hash,
      kind: 'integrity-error',
    });

    render(<CuratorArtifactPreview artifact={artifact} onOutcomeChange={vi.fn()} />);

    expect(await screen.findByText('Preview integrity check failed')).toBeVisible();
    expect(screen.queryByTitle('Curator preview of game.html')).not.toBeInTheDocument();
  });

  it('requires a fresh task resolution instead of retrying an expired signed preview URL', async () => {
    loadInteractiveHtmlRuntime.mockResolvedValue({
      kind: 'fetch-error',
      message: 'Request failed (403)',
      status: 403,
    });

    render(<CuratorArtifactPreview artifact={artifact} onOutcomeChange={vi.fn()} />);

    expect(await screen.findByText('Preview link expired')).toBeVisible();
    expect(screen.getByText(/Resolve the task again for a fresh link/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry preview' })).not.toBeInTheDocument();
  });

  it('allows a retry only after a non-authentication preview failure', async () => {
    loadInteractiveHtmlRuntime
      .mockResolvedValueOnce({
        kind: 'fetch-error',
        message: 'Network disconnected',
        status: null,
      })
      .mockResolvedValueOnce({
        byteLength: 128,
        document: '<!doctype html><html><body>Reviewed game</body></html>',
        kind: 'ready',
        sha256: artifact.sha256Hash,
      });

    render(<CuratorArtifactPreview artifact={artifact} onOutcomeChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry preview' }));

    await waitFor(() => expect(loadInteractiveHtmlRuntime).toHaveBeenCalledTimes(2));
    expect(await screen.findByTitle('Curator preview of game.html')).toBeVisible();
  });
});
