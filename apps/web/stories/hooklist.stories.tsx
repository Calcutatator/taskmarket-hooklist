import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

// storybook-coverage: components/market/hook-inspection.tsx
// storybook-coverage: components/market/hooklist.tsx
import { HookInspection } from '@/components/market/hook-inspection';
import { HookBuilder, HooklistDirectory } from '@/components/market/hooklist';
import { initialHookBuilderInput, type PublicHook } from '@/lib/hooklist';

function HooklistCatalog() {
  return <div>Taskmarket Hooklist components</div>;
}

const meta = {
  component: HooklistCatalog,
  parameters: { a11y: { test: 'error' }, layout: 'fullscreen' },
  title: 'Product/Hooklist',
} satisfies Meta<typeof HooklistCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const hooks: PublicHook[] = [
  {
    activePhaseTaskCount: 2,
    address: '0x1111111111111111111111111111111111111111',
    modes: ['bounty', 'claim'],
    taskCount: 4,
    taskIds: ['task-1'],
  },
  {
    activePhaseTaskCount: 0,
    address: '0x2222222222222222222222222222222222222222',
    modes: ['auction'],
    taskCount: 1,
    taskIds: ['task-2'],
  },
];

export const Discovery: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Filter hooks by task mode' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'auction' }));
    await expect(canvas.getByText('0x222222…222222')).toBeVisible();
    await expect(canvas.queryByText('0x111111…111111')).not.toBeInTheDocument();
    await expect(canvas.getByRole('status')).toHaveTextContent(
      /first 2 most-referenced hook addresses/i
    );
  },
  render: () => (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <HooklistDirectory hasMore hooks={[...hooks]} />
    </div>
  ),
};

export const EmptyDiscovery: Story = {
  render: () => (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <HooklistDirectory hooks={[]} />
    </div>
  ),
};

export const UnavailableDiscovery: Story = {
  render: () => (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <HooklistDirectory
        errorMessage="The public market API is unavailable. Try again shortly."
        hooks={[]}
      />
    </div>
  ),
};

export const Inspection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: hooks[0].address })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Configure a manifest/i })).toHaveAttribute(
      'href',
      `/hooks/build?address=${hooks[0].address}`
    );
  },
  render: () => (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <HookInspection hook={hooks[0]} />
    </div>
  ),
};

export const MissingInspection: Story = {
  render: () => (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <HookInspection hook={null} />
    </div>
  ),
};

export const BuilderDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Draft scaffold')).toBeVisible();
    await expect(canvas.getByText(/This output is intentionally marked x-draft/i)).toBeVisible();
    const checkClaim = canvas.getByRole('checkbox', { name: /checkClaim/i });
    await userEvent.click(checkClaim);
    await expect(checkClaim).toBeChecked();
    await expect(canvas.getByLabelText('taskmarket-hook.json preview')).toHaveTextContent(
      '"checkClaim"'
    );
    await expect(canvas.getByLabelText('Solidity scaffold preview')).toHaveTextContent(
      'function _checkClaim('
    );
    await userEvent.type(canvas.getByLabelText('Deployment chain ID'), '84532');
    await userEvent.type(canvas.getByLabelText('Deployment network'), 'base-sepolia');
    await expect(canvas.getByLabelText('taskmarket-hook.json preview')).toHaveTextContent(
      '"chainId": 84532'
    );
    await expect(canvas.getByLabelText('taskmarket-hook.json preview')).toHaveTextContent(
      '"network": "base-sepolia"'
    );
    const draftManifest = JSON.parse(
      canvas.getByLabelText('taskmarket-hook.json preview').textContent ?? '{}'
    );
    await expect(draftManifest).not.toHaveProperty('gas');
    await expect(draftManifest.deployments[0].gas.estimates.checkClaim).toMatchObject({
      maximum: 0,
      typical: 0,
    });
  },
  render: () => (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <HookBuilder />
    </div>
  ),
};

export const BuilderReady: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Evidence complete')).toBeVisible();
    await expect(canvas.queryByText('Draft scaffold')).not.toBeInTheDocument();
    await expect(canvas.getByLabelText('Deployment chain ID')).toHaveValue('84532');
    await expect(canvas.getByLabelText('Deployment network')).toHaveValue('base-sepolia');
    await expect(canvas.getByLabelText('taskmarket-hook.json preview')).toHaveTextContent(
      '"chainId": 84532'
    );
    await expect(canvas.getByLabelText('taskmarket-hook.json preview')).toHaveTextContent(
      '"network": "base-sepolia"'
    );
    const manifest = JSON.parse(
      canvas.getByLabelText('taskmarket-hook.json preview').textContent ?? '{}'
    );
    await expect(manifest).not.toHaveProperty('gas');
    await expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: 120000,
      typical: 100000,
    });
    await expect(manifest.externalDependencies[0].deployments[0]).toEqual({
      chainId: 84532,
      url: 'https://api.example.com/v1/policy',
    });
    await expect(manifest.privilegedRoles[0].holders[0]).toEqual({
      address: '0x4444444444444444444444444444444444444444',
      chainId: 84532,
    });
  },
  render: () => (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <HookBuilder
        initialInput={{
          ...initialHookBuilderInput,
          author: 'Taskmarket contributor',
          authorUrl: 'https://github.com/taskmarket',
          commit: 'abcdef0',
          conformanceStatus: 'tested',
          conformanceEvidenceUrl: 'https://github.com/taskmarket/hooks/actions/runs/1',
          deploymentBlockNumber: '123',
          deploymentChainId: '84532',
          deploymentNetwork: 'base-sepolia',
          deploymentTransactionHash: `0x${'1'.repeat(64)}`,
          description: 'Rejects incomplete configuration.',
          externalDependencies: JSON.stringify([
            {
              name: 'policy API',
              kind: 'api',
              deployments: [{ chainId: 84532, url: 'https://api.example.com/v1/policy' }],
              purpose: 'Reads policy metadata.',
            },
          ]),
          gasMethodology: 'Foundry gas snapshot on a Base Sepolia fork.',
          hookAddress: '0x1111111111111111111111111111111111111111',
          livenessFailureMode: 'A rejecting callback blocks task creation.',
          livenessRequirements: '[]',
          listingStatus: 'unlisted',
          maximumGas: '120000',
          name: 'Approved configuration',
          protocolDefaultStatus: 'not-default',
          privilegedRoles: JSON.stringify([
            {
              name: 'configuration administrator',
              holders: [
                {
                  chainId: 84532,
                  address: '0x4444444444444444444444444444444444444444',
                },
              ],
              capabilities: ['update approved configuration'],
              renounceable: true,
            },
          ]),
          repository: 'https://github.com/taskmarket/hooks',
          runtimeCodehash: `0x${'2'.repeat(64)}`,
          securityAuditScope: 'Generated hook source and deployment metadata.',
          securityAuditStatus: 'unaudited',
          securityNotes: 'No audit is claimed.',
          sourcePath: 'src/ApprovedConfigurationHook.sol',
          sourceVerification: 'unverified',
          taskmarket: '0x2222222222222222222222222222222222222222',
          trustReviewed: true,
          typicalGas: '100000',
        }}
      />
    </div>
  ),
};
