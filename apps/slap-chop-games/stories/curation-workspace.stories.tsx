// Verifies: ADR-0087 and ADR-0088
import type {
  GameCurationGame,
  GameCurationMutationResponse,
  GameCurationResolvedTask,
} from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';

import { CurateWorkspaceRoute } from '@/components/curate/curate-workspace-route';
import { CurationWorkspace, type CuratorAuth } from '@/components/curate/curation-workspace';
import { CurationApiError, type CurationApi } from '@/lib/curation-api';

const taskId = 'task-curation-story';
const submissionId = 'submission-curation-story';
const artifactId = 'artifact-curation-story';
const previewHtml = '<!doctype html><html><body><main>Curator preview ready</main></body></html>';
const previewUrl = `data:text/html,${encodeURIComponent(previewHtml)}`;
const previewSha256 = '1491dc6334c147c8bb229a5b61a77a45933ea09837392bdeb19341d91418b75c';

const resolution: GameCurationResolvedTask = {
  eligible: true,
  eligibilityReason: null,
  submissions: [
    {
      artifacts: [
        {
          fileName: 'curated-game.html',
          id: artifactId,
          keccak256Hash: `0x${'1'.repeat(64)}`,
          mimeType: 'text/html',
          previewUrl,
          previewUrlExpiresAt: '2026-08-16T01:00:00.000Z',
          role: 'final',
          sha256Hash: previewSha256,
          sizeBytes: new TextEncoder().encode(previewHtml).byteLength,
        },
      ],
      id: submissionId,
      submittedAt: '2026-08-16T00:00:00.000Z',
      workerAddress: '0x1111111111111111111111111111111111111111',
    },
  ],
  task: {
    description: 'Build a compact game that can be reviewed in one screen.',
    id: taskId,
    status: 'completed',
    tags: ['arcade', 'reviewed'],
  },
};

const ineligibleResolution: GameCurationResolvedTask = {
  ...resolution,
  eligible: false,
  eligibilityReason: 'Task has no currently deliverable playable HTML artifacts.',
  submissions: [],
};

function curationGame(overrides: Partial<GameCurationGame> = {}): GameCurationGame {
  return {
    artifactId,
    artifactKeccak256Hash: `0x${'1'.repeat(64)}`,
    artifactMimeType: 'text/html',
    artifactSha256Hash: previewSha256,
    artifactSizeBytes: new TextEncoder().encode(previewHtml).byteLength,
    coverAltText: 'Square cover for Curator Preview Ready',
    coverArtifactId: null,
    coverHeight: 64,
    coverMimeType: 'image/png',
    coverSha256Hash: 'a'.repeat(64),
    coverSource: 'catalog_asset',
    coverWidth: 64,
    createdAt: '2026-08-16T00:00:00.000Z',
    creatorName: 'Arcade Builder',
    description: 'A compact reviewed game.',
    hiddenAt: null,
    id: 'game-curation-story',
    previewedAt: '2026-08-16T00:01:00.000Z',
    publishedAt: null,
    slug: 'curator-preview-ready',
    status: 'draft',
    submissionId,
    tags: ['arcade'],
    taskId,
    title: 'Curator Preview Ready',
    updatedAt: '2026-08-16T00:01:00.000Z',
    ...overrides,
  };
}

function mutation(game: GameCurationGame): GameCurationMutationResponse {
  return { game };
}

function auth(overrides: Partial<CuratorAuth> = {}): CuratorAuth {
  return {
    authenticated: true,
    configured: true,
    getAccessToken: async () => 'storybook-privy-token',
    login: () => undefined,
    ready: true,
    ...overrides,
  };
}

function api(overrides: Partial<CurationApi> = {}): CurationApi {
  return {
    hide: async () =>
      mutation(curationGame({ hiddenAt: '2026-08-16T00:03:00.000Z', status: 'hidden' })),
    publish: async () =>
      mutation(curationGame({ publishedAt: '2026-08-16T00:02:00.000Z', status: 'published' })),
    resolveTask: async () => resolution,
    upsert: async () => mutation(curationGame()),
    ...overrides,
  };
}

function Workspace({
  auth: curatorAuth = auth(),
  api: curatorApi = api(),
}: Readonly<{
  auth?: CuratorAuth;
  api?: CurationApi;
}>) {
  return <CurationWorkspace api={curatorApi} auth={curatorAuth} />;
}

async function resolveTask(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText('Task URL or ID'), taskId);
  await userEvent.click(canvas.getByRole('button', { name: 'Resolve task' }));
  await expect(await canvas.findByRole('radio', { name: /curated-game.html/i })).toBeVisible();
  await waitFor(() => expect(canvas.getByRole('button', { name: 'Resolve task' })).toBeEnabled());
}

const meta = {
  component: Workspace,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Curate/Curation workspace',
} satisfies Meta<typeof Workspace>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/curate/curation-workspace.tsx
// storybook-coverage: components/curate/curate-workspace-route.tsx
export const SignInRequired: Story = {
  args: {
    auth: auth({ authenticated: false }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Curator sign-in required' })).toBeVisible();
  },
};

export const Unavailable: Story = {
  args: {
    auth: auth({ configured: false }),
  },
};

export const ResolvedArtifact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resolveTask(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: /curated-game.html/i }));
    const previewFrame = canvas.getByTitle('Curator preview of curated-game.html');
    const previewSection = previewFrame.closest('section');
    if (!previewSection) throw new Error('Curator preview section is missing.');

    await expect(previewFrame).toBeVisible();
    await expect(within(previewSection).getByText(`SHA-256 ${previewSha256}`)).toBeVisible();
  },
};

export const NoEligibleArtifacts: Story = {
  args: {
    api: api({ resolveTask: async () => ineligibleResolution }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Task URL or ID'), taskId);
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve task' }));
    await expect(canvas.getByText('No eligible playable artifact')).toBeVisible();
  },
};

export const AuthorizationFailure: Story = {
  args: {
    api: api({
      resolveTask: async () => {
        throw new CurationApiError('unauthorized', 'Curator access is not authorized', 403);
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Task URL or ID'), taskId);
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve task' }));
    await expect(canvas.getByRole('heading', { name: 'Curator access denied' })).toBeVisible();
  },
};

export const ExpiredSession: Story = {
  args: {
    auth: auth({ getAccessToken: async () => null }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Task URL or ID'), taskId);
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve task' }));
    await expect(canvas.getByRole('heading', { name: 'Curator session expired' })).toBeVisible();
  },
};

export const LongMetadata: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resolveTask(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: /curated-game.html/i }));
    fireEvent.change(canvas.getByLabelText(/^Title/), {
      target: { value: 'A very long but still deliberate curator-facing game title for review' },
    });
    fireEvent.change(canvas.getByLabelText('Description'), {
      target: {
        value:
          'This long metadata treatment demonstrates that the curator workspace preserves readable editing controls and clear source provenance when the editorial summary needs a fuller explanation of the game, its play loop, and its review context.',
      },
    });
    fireEvent.change(canvas.getByLabelText('Tags'), {
      target: { value: 'arcade, reviewed, one-screen, experimental, provenance' },
    });
    await expect(canvas.getByDisplayValue(/fuller explanation/i)).toBeVisible();
  },
};

export const InvalidSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resolveTask(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: /curated-game.html/i }));
    fireEvent.change(canvas.getByLabelText(/^Title/), { target: { value: 'Curated Game' } });
    fireEvent.change(canvas.getByLabelText(/^Unique slug/), { target: { value: 'Not a slug' } });
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await expect(canvas.getByText('Game slugs must be lowercase kebab-case')).toBeVisible();
  },
};

export const Conflict: Story = {
  args: {
    api: api({
      upsert: async () => {
        throw new CurationApiError('conflict', 'Game changed before it could be saved', 409);
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resolveTask(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: /curated-game.html/i }));
    fireEvent.change(canvas.getByLabelText(/^Title/), { target: { value: 'Curated Game' } });
    fireEvent.change(canvas.getByLabelText(/^Unique slug/), { target: { value: 'curated-game' } });
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await expect(canvas.getByText('Curation conflict')).toBeVisible();
  },
};

export const ServerError: Story = {
  args: {
    api: api({
      resolveTask: async () => {
        throw new CurationApiError('server', 'Gateway unavailable', 503);
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Task URL or ID'), taskId);
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve task' }));
    await expect(canvas.getByText('Curation server error')).toBeVisible();
  },
};

export const PublishConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resolveTask(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: /curated-game.html/i }));
    await expect(canvas.getByTitle('Curator preview of curated-game.html')).toBeVisible();
    fireEvent.change(canvas.getByLabelText(/^Title/), {
      target: { value: 'Curator Preview Ready' },
    });
    fireEvent.change(canvas.getByLabelText(/^Unique slug/), {
      target: { value: 'curator-preview-ready' },
    });
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await expect(canvas.getByText('Draft saved')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Review publication' }));
    await expect(canvas.getByText('Confirm publication')).toBeVisible();
  },
};

export const RouteUnavailable: Story = {
  render: () => <CurateWorkspaceRoute />,
};

export const Phone: Story = {
  globals: {
    viewport: { value: 'phone', isRotated: false },
  },
};

export const Light: Story = {
  globals: {
    theme: 'light',
    viewport: { value: 'desktop', isRotated: false },
  },
};
