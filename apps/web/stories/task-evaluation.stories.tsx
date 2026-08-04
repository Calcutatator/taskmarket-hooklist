// storybook-coverage: components/market/task-evaluation-terms.tsx
// storybook-coverage: components/market/task-evaluation-section.tsx
// storybook-coverage: components/market/actions/assign-evaluator-action.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useEffect, type ReactNode } from 'react';
import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, useAccount, useConnect, WagmiProvider } from 'wagmi';
import { mock } from 'wagmi/connectors';

import {
  AssignEvaluatorAction,
  EvaluatorAppointmentInFlight,
} from '@/components/market/actions/assign-evaluator-action';
import { TaskEvaluationTerms } from '@/components/market/task-evaluation-terms';

import { addresses, taskDetailFixture } from './fixtures';

function EvaluationCatalog() {
  return <div>Taskmarket evaluation terms</div>;
}

const meta = {
  component: EvaluationCatalog,
  parameters: {
    a11y: { test: 'error' },
  },
  title: 'Product/Task evaluation',
} satisfies Meta<typeof EvaluationCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const DISPUTE_RESOLVER = '0x5555555555555555555555555555555555555555';

function connectedAs(account: `0x${string}`) {
  return createConfig({
    chains: [base, baseSepolia],
    connectors: [mock({ accounts: [account] })],
    transports: {
      [base.id]: http(),
      [baseSepolia.id]: http(),
    },
  });
}

function ConnectStoryWallet({ children }: Readonly<{ children: ReactNode }>) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (!isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [connect, connectors, isConnected]);

  return isConnected ? (
    children
  ) : (
    <p className="text-sm text-muted-foreground">Connecting story wallet...</p>
  );
}

function ConnectedAs({
  account,
  children,
}: Readonly<{ account: `0x${string}`; children: ReactNode }>) {
  return (
    <WagmiProvider config={connectedAs(account)} reconnectOnMount={false}>
      <ConnectStoryWallet>{children}</ConnectStoryWallet>
    </WagmiProvider>
  );
}

const appointedTask = taskDetailFixture({
  appealDeadline: new Date('2026-08-12T10:00:00Z').toISOString(),
  appealWindow: 172_800,
  disputeResolver: DISPUTE_RESOLVER,
  evaluationWindow: 86_400,
  evaluator: addresses.evaluator,
  evaluatorDeadline: new Date('2026-08-10T10:00:00Z').toISOString(),
  evaluatorFeeBps: 750,
  id: 'task-eval-1',
  reward: '25000000',
  status: 'pending_approval',
});

const unassignedTask = taskDetailFixture({
  claimedBy: null,
  evaluator: null,
  id: 'task-eval-2',
  reward: '25000000',
  status: 'open',
});

/**
 * The state the whole card exists for: a worker can see who judges the work, that a slice of
 * the advertised reward is not theirs, and how long each window runs.
 */
export const EvaluatorAppointed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Evaluation terms' })).toBeVisible();
    // The fee must be legible both as a percentage and as money, or the "advertised reward is
    // not what you receive" point does not land.
    await expect(canvas.getByText('7.50%')).toBeVisible();
    await expect(canvas.getByText(/About 1.875 USDC of the 25 USDC reward/)).toBeVisible();
  },
  render: () => <TaskEvaluationTerms task={appointedTask} />,
};

/** A registered evaluator resolves to its agent name rather than raw hex. */
export const RegisteredEvaluatorIdentity: Story = {
  render: () => (
    <TaskEvaluationTerms disputeResolverAgentId="7" evaluatorAgentId="42" task={appointedTask} />
  ),
};

/** The common case: nobody involved is a registered agent, so addresses are all there is. */
export const UnregisteredEvaluatorRawAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTitle(addresses.evaluator)).toBeVisible();
  },
  render: () => <TaskEvaluationTerms task={appointedTask} />,
};

/** A long identity must truncate inside a narrow column rather than widen the page. */
export const LongIdentityInNarrowColumn: Story = {
  render: () => (
    <div className="max-w-xs">
      <TaskEvaluationTerms
        disputeResolverAgentId="123456789012345678901234567890"
        evaluatorAgentId="987654321098765432109876543210"
        task={appointedTask}
      />
    </div>
  ),
};

/** A zero fee must read as "the worker keeps the reward", not as a missing value. */
export const ZeroFee: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('None')).toBeVisible();
    await expect(canvas.getByText(/full reward goes to the worker/)).toBeVisible();
  },
  render: () => (
    <TaskEvaluationTerms task={taskDetailFixture({ ...appointedTask, evaluatorFeeBps: 0 })} />
  ),
};

/** The evaluator viewing the task sees the same terms; nothing here is requester-only. */
export const ViewerIsTheEvaluator: Story = {
  render: () => (
    <ConnectedAs account={addresses.evaluator}>
      <TaskEvaluationTerms task={appointedTask} />
      <AssignEvaluatorAction task={appointedTask} />
    </ConnectedAs>
  ),
};

/** No evaluator, and the connected requester can still appoint one. */
export const NoneButViewerEligible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole('button', { name: 'Appoint evaluator' });
    await userEvent.click(button);
    // The confirm dialog must state the consequence before any payment is signed.
    const dialog = await findConfirmDialog();
    await expect(
      within(dialog).getByText(/changes the terms a worker is deciding on/)
    ).toBeVisible();
  },
  render: () => (
    <ConnectedAs account={addresses.requester}>
      <AssignEvaluatorAction task={unassignedTask} />
    </ConnectedAs>
  ),
};

/** A worker looking at the same task gets nothing: the control would only fail server-side. */
export const NoneAndIneligible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Appoint evaluator' })).toBeNull()
    );
    await expect(canvas.queryByRole('region', { name: 'Evaluation terms' })).toBeNull();
  },
  render: () => (
    <ConnectedAs account={addresses.worker}>
      <TaskEvaluationTerms task={unassignedTask} />
      <AssignEvaluatorAction task={unassignedTask} />
    </ConnectedAs>
  ),
};

/** A claimed task can never take an evaluator, so the control does not render. */
export const NoneAndTaskAlreadyClaimed: Story = {
  render: () => (
    <ConnectedAs account={addresses.requester}>
      <AssignEvaluatorAction
        task={taskDetailFixture({
          ...unassignedTask,
          claimedBy: addresses.worker,
          status: 'claimed',
        })}
      />
    </ConnectedAs>
  ),
};

/**
 * The outcome this branch exists for: the write was broadcast and nothing is settled. The
 * copy must claim neither success nor failure, and must offer no retry.
 */
export const InFlight: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Appointment submitted, confirming')).toBeVisible();
    await expect(canvas.getByText(/not a success and not a failure/)).toBeVisible();
    // The absence of a retry is the point, not an oversight.
    await expect(canvas.queryByRole('button')).toBeNull();
  },
  render: () => (
    <EvaluatorAppointmentInFlight idempotencyKey="9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e" />
  ),
};

/** Still unsettled after the poll budget: still no retry, just a handle to quote. */
export const InFlightStalled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Still not settled/)).toBeVisible();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
  render: () => (
    <EvaluatorAppointmentInFlight idempotencyKey="9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e" stalled />
  ),
};

/** In-flight, dark theme. */
export const InFlightDark: Story = {
  globals: { theme: 'dark' },
  render: () => (
    <EvaluatorAppointmentInFlight idempotencyKey="9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e" />
  ),
};

/** Mobile: the three window inputs must stack rather than crush. */
export const AppointedMobile: Story = {
  // Storybook 10 reads the viewport from globals; `parameters.viewport.defaultViewport` is
  // the pre-9 form and is silently ignored, so a story using it renders at desktop width.
  globals: { viewport: { value: 'mobile' } },
  render: () => <TaskEvaluationTerms task={appointedTask} />,
};

/** Mobile, unassigned: the form must remain usable at the narrowest supported width. */
export const AssignFormMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: () => (
    <ConnectedAs account={addresses.requester}>
      <AssignEvaluatorAction task={unassignedTask} />
    </ConnectedAs>
  ),
};

/** Dark theme: every token used here must have a dark counterpart. */
export const AppointedDark: Story = {
  globals: { theme: 'dark' },
  render: () => <TaskEvaluationTerms task={appointedTask} />,
};

// --- story-local helpers -------------------------------------------------------------

// The confirm dialog portals outside the canvas element, so this reaches for the document.
async function findConfirmDialog(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector('[role="dialog"]');
    if (!found) throw new Error('confirm dialog did not open');
    return found as HTMLElement;
  });
}
