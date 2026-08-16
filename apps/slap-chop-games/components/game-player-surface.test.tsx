import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { gameFixture } from '@/test/game-fixtures';

import { GamePlayerSurface } from './game-player-surface';

function renderSurface(
  outcome: Parameters<typeof GamePlayerSurface>[0]['runtimeOutcome'],
  overrides: Partial<Parameters<typeof GamePlayerSurface>[0]> = {}
) {
  const onBack = vi.fn();
  const onRetry = vi.fn();

  render(
    <GamePlayerSurface
      game={gameFixture}
      onBack={onBack}
      onRetry={onRetry}
      retrying={false}
      runtimeOutcome={outcome}
      {...overrides}
    />
  );

  return { onBack, onRetry };
}

describe('GamePlayerSurface', () => {
  it('keeps app-owned Back, title, score, and status controls available while loading', async () => {
    const user = userEvent.setup();
    const { onBack } = renderSurface({ kind: 'loading' });

    expect(screen.getByRole('heading', { name: 'Silent Orbit' })).toBeVisible();
    expect(screen.getByText('+18')).toBeVisible();
    expect(screen.getByText('Loading', { selector: '#game-player-status' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Loading game' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back to catalog' }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it('uses exactly the shared capability-closed iframe contract after a verified ready outcome', () => {
    renderSurface({
      byteLength: 88,
      document: '<!doctype html><html><body>Verified game</body></html>',
      kind: 'ready',
      sha256: gameFixture.source.artifactSha256Hash,
    });

    const iframe = screen.getByTitle('Silent Orbit game');

    expect(iframe).toHaveAttribute('allow', '');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it.each([
    [
      {
        kind: 'ineligible' as const,
        maxBytes: 5 * 1024 * 1024,
        reason: 'declared-size-exceeded' as const,
      },
      'Game exceeds the play limit',
    ],
    [
      { byteLength: null, kind: 'fetched-size-exceeded' as const, maxBytes: 5 * 1024 * 1024 },
      'Delivered game exceeds the play limit',
    ],
    [
      {
        actualSha256: 'b'.repeat(64),
        expectedSha256: 'a'.repeat(64),
        kind: 'integrity-error' as const,
      },
      'Game integrity check failed',
    ],
    [
      { kind: 'fetch-error' as const, message: 'Request failed (403)', status: 403 },
      'Game link expired',
    ],
    [
      { kind: 'runtime-error' as const, message: 'Web Crypto is unavailable.' },
      'Game could not be prepared',
    ],
  ])('renders a usable typed runtime state: %s', async (outcome, title) => {
    const user = userEvent.setup();
    const { onBack, onRetry } = renderSurface(outcome);

    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to catalog' })).toBeEnabled();

    const retry = screen.queryByRole('button', { name: /refresh game link|retry game/i });
    if (retry) {
      await user.click(retry);
      expect(onRetry).toHaveBeenCalledOnce();
    }

    await user.click(screen.getByRole('button', { name: 'Back to catalog' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps return controls available when the route cannot read the game detail DTO', async () => {
    const user = userEvent.setup();
    const { onBack, onRetry } = renderSurface(
      { kind: 'loading' },
      { detailFailure: { kind: 'unavailable', status: 503 }, game: null }
    );

    expect(screen.getByRole('heading', { name: 'Game details unavailable' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'Back to catalog' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
