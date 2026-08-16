import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { GamePlayerSurface } from '@/components/game-player-surface';
import { gameFixture } from '@/test/game-fixtures';

const meta = {
  args: {
    game: gameFixture,
    onBack: fn(),
    onRetry: fn(),
    retrying: false,
  },
  component: GamePlayerSurface,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Player/Game player surface',
} satisfies Meta<typeof GamePlayerSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/game-player-surface.tsx
export const Loading: Story = {
  args: {
    runtimeOutcome: { kind: 'loading' },
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Back to catalog' }));

    await expect(args.onBack).toHaveBeenCalledOnce();
  },
};

export const Ready: Story = {
  args: {
    runtimeOutcome: {
      byteLength: 88,
      document: '<!doctype html><html><body>Verified game</body></html>',
      kind: 'ready',
      sha256: gameFixture.source.artifactSha256Hash,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const iframe = canvas.getByTitle('Silent Orbit game');

    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('allow', '');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  },
};

export const ExpiredLink: Story = {
  args: {
    runtimeOutcome: { kind: 'fetch-error', message: 'Request failed (403)', status: 403 },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Refresh game link' }));

    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const DeclaredOversize: Story = {
  args: {
    runtimeOutcome: {
      kind: 'ineligible',
      maxBytes: 5 * 1024 * 1024,
      reason: 'declared-size-exceeded',
    },
  },
};

export const UnsupportedArtifact: Story = {
  args: {
    runtimeOutcome: {
      kind: 'ineligible',
      maxBytes: 5 * 1024 * 1024,
      reason: 'unsupported-artifact',
    },
  },
};

export const FetchedOversize: Story = {
  args: {
    runtimeOutcome: {
      byteLength: 5 * 1024 * 1024 + 1,
      kind: 'fetched-size-exceeded',
      maxBytes: 5 * 1024 * 1024,
    },
  },
};

export const IntegrityFailure: Story = {
  args: {
    runtimeOutcome: {
      actualSha256: 'b'.repeat(64),
      expectedSha256: gameFixture.source.artifactSha256Hash,
      kind: 'integrity-error',
    },
  },
};

export const FetchFailure: Story = {
  args: {
    runtimeOutcome: { kind: 'fetch-error', message: 'Network disconnected', status: null },
  },
};

export const RuntimeFailure: Story = {
  args: {
    runtimeOutcome: { kind: 'runtime-error', message: 'Web Crypto is unavailable.' },
  },
};

export const DetailUnavailable: Story = {
  args: {
    detailFailure: { kind: 'unavailable', status: 503 },
    game: null,
    runtimeOutcome: { kind: 'loading' },
  },
};

export const Phone: Story = {
  args: Loading.args,
  globals: {
    viewport: { value: 'phone', isRotated: false },
  },
};

export const Light: Story = {
  args: Loading.args,
  globals: {
    theme: 'light',
    viewport: { value: 'desktop', isRotated: false },
  },
};
