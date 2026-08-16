// Verifies: ADR-0087 and ADR-0088
import type { GameCurationArtifact } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';

import {
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_REFERRER_POLICY,
} from '@taskmarket/html-sandbox';

import { CuratorArtifactPreview } from '@/components/curate/curator-artifact-preview';

const previewHtml = '<!doctype html><html><body><main>Curator preview ready</main></body></html>';
const previewUrl = `data:text/html,${encodeURIComponent(previewHtml)}`;
const previewSha256 = '1491dc6334c147c8bb229a5b61a77a45933ea09837392bdeb19341d91418b75c';

const artifact: GameCurationArtifact = {
  fileName: 'curated-game.html',
  id: 'artifact-curator-preview-story',
  keccak256Hash: `0x${'1'.repeat(64)}`,
  mimeType: 'text/html',
  previewUrl,
  previewUrlExpiresAt: '2026-08-16T01:00:00.000Z',
  role: 'final',
  sha256Hash: previewSha256,
  sizeBytes: new TextEncoder().encode(previewHtml).byteLength,
};

const meta = {
  args: {
    artifact,
    onOutcomeChange: fn(),
  },
  component: CuratorArtifactPreview,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Curate/Curator artifact preview',
} satisfies Meta<typeof CuratorArtifactPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/curate/curator-artifact-preview.tsx
export const NoSelection: Story = {
  args: {
    artifact: null,
  },
};

export const VerifiedArtifact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      const iframe = canvas.getByTitle('Curator preview of curated-game.html');
      await expect(iframe).toHaveAttribute('sandbox', INTERACTIVE_HTML_IFRAME_SANDBOX);
      await expect(iframe).toHaveAttribute('allow', INTERACTIVE_HTML_IFRAME_ALLOW);
      await expect(iframe).toHaveAttribute('referrerpolicy', INTERACTIVE_HTML_REFERRER_POLICY);
    });
  },
};
