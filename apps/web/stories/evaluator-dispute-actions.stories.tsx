// storybook-coverage: components/market/actions/evaluator-actions.tsx
// storybook-coverage: components/market/verdict-evidence-panel.tsx

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MotionConfig } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { expect, within } from 'storybook/test';
import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, useAccount, useConnect, WagmiProvider } from 'wagmi';
import { mock } from 'wagmi/connectors';

import {
  AppealButton,
  EvaluateButton,
  EvaluatorTimeoutButton,
  FinalizeVerdictButton,
  ResolveDisputeButton,
} from '@/components/market/actions/evaluator-actions';
import { SubmissionCard } from '@/components/market/tasks';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
import { VerdictEvidencePanel } from '@/components/market/verdict-evidence-panel';

import { addresses, artifactFixture, submissionFixture, taskDetailFixture } from './fixtures';

function EvaluatorDisputeCatalogue() {
  return <div>Evaluator and dispute action states</div>;
}

type MockRequestBody = { id?: number; method?: string };

const paidSubmitAttempts = new Map<string, number>();

function x402Challenge() {
  return {
    accepts: [
      {
        amount: '1000',
        asset: addresses.requester,
        extra: {
          eip712: {
            domain: {
              chainId: base.id,
              name: 'USD Coin',
              verifyingContract: addresses.requester,
              version: '2',
            },
            types: {
              TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
              ],
            },
          },
        },
        maxTimeoutSeconds: 300,
        network: 'eip155:8453',
        payTo: addresses.requester,
        scheme: 'exact',
      },
    ],
  };
}

function installEvaluatorRequestMock() {
  const originalFetch = globalThis.fetch;
  paidSubmitAttempts.clear();

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(requestUrl, globalThis.location?.origin ?? 'http://localhost');
    const requestBody =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as MockRequestBody)
        : input instanceof Request
          ? ((await input
              .clone()
              .json()
              .catch(() => ({}))) as MockRequestBody)
          : {};

    if (requestBody.method === 'eth_signTypedData_v4') {
      return Response.json({
        id: requestBody.id ?? 1,
        jsonrpc: '2.0',
        result: `0x${'1'.repeat(130)}`,
      });
    }

    if (url.pathname.endsWith('/finalize-verdict')) {
      return Response.json({ txHash: `0x${'a'.repeat(64)}` });
    }

    if (/\/(evaluate|appeal|evaluator-timeout|resolve-dispute)$/.test(url.pathname)) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      const taskId = url.pathname.split('/')[3] ?? '';
      if (!headers.has('payment-signature')) {
        if (taskId === 'task-payment-loading') return new Promise<Response>(() => undefined);
        return Response.json(x402Challenge(), { status: 402 });
      }
      if (taskId === 'task-submitting') return new Promise<Response>(() => undefined);
      if (taskId === 'task-error-recovery') {
        const attempt = (paidSubmitAttempts.get(taskId) ?? 0) + 1;
        paidSubmitAttempts.set(taskId, attempt);
        if (attempt === 1) {
          return Response.json({ message: 'Action is no longer available' }, { status: 409 });
        }
      }
      return Response.json({ txHash: `0x${'b'.repeat(64)}` });
    }

    return originalFetch(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
    paidSubmitAttempts.clear();
  };
}

const meta = {
  beforeEach: installEvaluatorRequestMock,
  component: EvaluatorDisputeCatalogue,
  parameters: {
    a11y: { test: 'error' },
    layout: 'padded',
  },
  title: 'Product/Task actions/Evaluator and dispute matrix',
} satisfies Meta<typeof EvaluatorDisputeCatalogue>;

export default meta;
type Story = StoryObj<typeof meta>;

function StoryWallet({
  address,
  children,
  connected = true,
}: Readonly<{ address: `0x${string}`; children: ReactNode; connected?: boolean }>) {
  const [config] = useState(() =>
    createConfig({
      chains: [base, baseSepolia],
      connectors: [mock({ accounts: [address] })],
      transports: {
        [base.id]: http(),
        [baseSepolia.id]: http(),
      },
    })
  );

  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      {connected ? <ConnectStoryWallet>{children}</ConnectStoryWallet> : children}
    </WagmiProvider>
  );
}

function ConnectStoryWallet({ children }: Readonly<{ children: ReactNode }>) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (!isConnected && connectors[0]) connect({ connector: connectors[0] });
  }, [connect, connectors, isConnected]);

  return isConnected ? (
    children
  ) : (
    <p className="text-sm text-muted-foreground">Connecting story wallet...</p>
  );
}

function action(
  actionName: PendingAction['action'],
  role: PendingAction['role'],
  taskId: string
): PendingAction {
  return {
    action: actionName,
    command: `taskmarket task ${actionName.replaceAll('_', '-')} ${taskId}`,
    role,
  };
}

function evaluationTask(overrides: Partial<TaskDetailResponse> = {}) {
  return taskDetailFixture({
    appealWindow: 86_400,
    claimedBy: addresses.worker,
    evaluator: addresses.evaluator,
    evaluatorDeadline: '2026-08-07T12:00:00.000Z',
    evaluatorFeeBps: 500,
    id: 'task-evaluator',
    reward: '100000000',
    status: 'review',
    submissionCount: 2,
    submissionVisibility: 'public',
    ...overrides,
  });
}

function recordedVerdictTask(overrides: Partial<TaskDetailResponse> = {}) {
  return evaluationTask({
    appealDeadline: '2026-08-08T12:00:00.000Z',
    disputeResolver: addresses.workerB,
    status: 'appealing',
    verdictConfidence: 875,
    verdictEvidenceHash: `0x${'c'.repeat(64)}`,
    verdictScore: 920,
    verdictType: 'APPROVE',
    ...overrides,
  });
}

function DecisionSurface({
  actionControl,
  task,
}: Readonly<{ actionControl: ReactNode; task: TaskDetailResponse }>) {
  return (
    <div className="grid max-w-3xl gap-6">
      <section
        aria-labelledby={`submitted-evidence-${task.id}`}
        className="grid gap-3"
        id="task-activity"
      >
        <div className="grid gap-1">
          <h2
            className="font-display font-semibold leading-none tracking-tight text-foreground"
            id={`submitted-evidence-${task.id}`}
          >
            Submitted evidence
          </h2>
          <p className="text-sm text-muted-foreground">
            Inspect the worker deliverable before making an irreversible decision.
          </p>
        </div>
        <SubmissionCard
          profileBasePath="/dashboard/agents"
          submission={submissionFixture({
            artifacts: [
              artifactFixture({
                fileName: 'evaluator-deliverable.pdf',
                mediaKind: 'pdf',
                mimeType: 'application/pdf',
                previewUrl: undefined,
                role: 'final',
                storageUri: 'ipfs://bafybeifake/evaluator-deliverable.pdf',
                taskId: task.id,
              }),
            ],
            fileUrl: 'ipfs://bafybeifake/evaluator-deliverable',
            taskId: task.id,
          })}
          task={task}
        />
      </section>
      <VerdictEvidencePanel forceVisible task={task} />
      <section aria-label="Available decision action" className="grid gap-3 border-t pt-5">
        {actionControl}
      </section>
    </div>
  );
}

export const EvaluatorVerdictValidationAndConfirmation: Story = {
  render: () => {
    const task = evaluationTask();
    return (
      <StoryWallet address={addresses.evaluator}>
        <DecisionSurface
          actionControl={
            <EvaluateButton
              action={action('evaluate', 'evaluator', task.id)}
              disabled={false}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await canvas.findByRole('region', { name: 'Verdict and decision evidence' })
    ).toHaveTextContent('No verdict has been recorded yet');
    const submittedEvidence = canvas.getByRole('region', { name: 'Submitted evidence' });
    await expect(submittedEvidence).toBeVisible();
    await expect(submittedEvidence).toHaveTextContent('evaluator-deliverable.pdf');

    const trigger = canvas.getByRole('button', { name: 'Submit evaluation' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveTextContent('costs 0.001 USDC and is irreversible');
    await expect(dialog).toHaveTextContent('opens an appeal window for 1 day');
    await expect(dialog).toHaveTextContent('settles the listed awards');
    await expect(dialog).toContainElement(
      canvasElement.ownerDocument.activeElement as HTMLElement | null
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit evaluation' }));
    await expect(await canvas.findByText(/evidence hash is required/i)).toBeVisible();
  },
};

export const RestrictedEvaluatorEvidenceAccess: Story = {
  render: () => {
    const task = evaluationTask({ submissionVisibility: 'never' });
    return (
      <StoryWallet address={addresses.evaluator}>
        <DecisionSurface
          actionControl={
            <TaskActionsPanel
              emptyReason="No evaluator actions are available."
              evidenceReady
              pendingActions={[action('evaluate', 'evaluator', task.id)]}
              requester={task.requester}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Submitted evidence' })).toHaveTextContent(
      'evaluator-deliverable.pdf'
    );
    await expect(
      canvas.getByRole('status', { name: 'Confidential evidence access' })
    ).toHaveTextContent(/access ends if the role is cleared/i);
    await expect(canvas.getByRole('button', { name: 'Submit evaluation' })).toBeVisible();
  },
};

export const EvaluatorPaymentLoading: Story = {
  render: () => {
    const task = evaluationTask({ id: 'task-payment-loading' });
    return (
      <StoryWallet address={addresses.evaluator}>
        <EvaluateButton
          action={action('evaluate', 'evaluator', task.id)}
          disabled={false}
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(await canvas.findByLabelText('Evidence hash'), `0x${'d'.repeat(64)}`);
    await userEvent.click(canvas.getByRole('button', { name: 'Submit evaluation' }));
    await userEvent.click(page.getAllByRole('button', { name: 'Submit evaluation' }).at(-1)!);
    await expect((await page.findAllByText('Fetching payment...')).length).toBeGreaterThan(0);
  },
};

export const EvaluatorSubmittingReducedMotion: Story = {
  parameters: { viewport: { defaultViewport: 'mobile' } },
  render: () => {
    const task = evaluationTask({ id: 'task-submitting' });
    return (
      <MotionConfig reducedMotion="always">
        <StoryWallet address={addresses.evaluator}>
          <DecisionSurface
            actionControl={
              <EvaluateButton
                action={action('evaluate', 'evaluator', task.id)}
                disabled={false}
                task={task}
              />
            }
            task={task}
          />
        </StoryWallet>
      </MotionConfig>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(await canvas.findByLabelText('Evidence hash'), `0x${'e'.repeat(64)}`);
    await userEvent.click(canvas.getByRole('button', { name: 'Submit evaluation' }));
    await userEvent.click(page.getAllByRole('button', { name: 'Submit evaluation' }).at(-1)!);
    await expect((await page.findAllByText('Submitting...')).length).toBeGreaterThan(0);
  },
};

export const EvaluatorBackendErrorRecovery: Story = {
  render: () => {
    const task = evaluationTask({ id: 'task-error-recovery' });
    return (
      <StoryWallet address={addresses.evaluator}>
        <EvaluateButton
          action={action('evaluate', 'evaluator', task.id)}
          disabled={false}
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(await canvas.findByLabelText('Evidence hash'), `0x${'f'.repeat(64)}`);

    await userEvent.click(canvas.getByRole('button', { name: 'Submit evaluation' }));
    await userEvent.click(page.getAllByRole('button', { name: 'Submit evaluation' }).at(-1)!);
    await expect(await canvas.findByText('Action is no longer available')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Submit evaluation' }));
    await userEvent.click(page.getAllByRole('button', { name: 'Submit evaluation' }).at(-1)!);
    await expect(await canvas.findByText('Evaluation submitted')).toBeVisible();
  },
};

export const WorkerAppealConfirmation: Story = {
  render: () => {
    const task = recordedVerdictTask({ id: 'task-appeal' });
    return (
      <StoryWallet address={addresses.worker}>
        <DecisionSurface
          actionControl={
            <AppealButton
              action={action('appeal', 'worker', task.id)}
              disabled={false}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const evidence = await canvas.findByRole('region', {
      name: 'Verdict and decision evidence',
    });
    await expect(evidence).toHaveTextContent('Approved');
    await expect(evidence).toHaveTextContent(`0x${'c'.repeat(64)}`);

    const trigger = canvas.getByRole('button', { name: 'Appeal verdict' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveTextContent('costs 0.001 USDC and is irreversible');
    await expect(dialog).toHaveTextContent('Submit before the appeal deadline');
    await expect(dialog).toHaveTextContent('settlement will pause');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expect(trigger).toHaveFocus();
  },
};

export const WorkerAppealExpiredMobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile' } },
  render: () => {
    const task = recordedVerdictTask({
      appealDeadline: '2026-07-01T00:00:00.000Z',
      id: 'task-appeal-expired',
    });
    return (
      <StoryWallet address={addresses.worker}>
        <DecisionSurface
          actionControl={
            <AppealButton action={action('appeal', 'worker', task.id)} disabled task={task} />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Appeal deadline')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Appeal verdict' })).toBeDisabled();
    await expect(canvas.getByText(`0x${'c'.repeat(64)}`)).toBeVisible();
  },
};

export const RequesterEvaluatorTimeoutConfirmation: Story = {
  render: () => {
    const task = evaluationTask({
      evaluatorDeadline: '2026-07-01T00:00:00.000Z',
      id: 'task-timeout',
    });
    return (
      <StoryWallet address={addresses.requester}>
        <DecisionSurface
          actionControl={
            <EvaluatorTimeoutButton
              action={action('evaluator_timeout', 'requester', task.id)}
              disabled={false}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Use evaluator timeout' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveTextContent('costs 0.001 USDC and is irreversible');
    await expect(dialog).toHaveTextContent('only available after the evaluator deadline');
    await expect(dialog).toHaveTextContent('returning the task to requester review');
    await expect(dialog).toHaveTextContent('without settling funds');
  },
};

export const PermissionlessFinalizationSuccess: Story = {
  render: () => {
    const task = recordedVerdictTask({ id: 'task-finalize' });
    return (
      <StoryWallet address={addresses.workerB}>
        <DecisionSurface
          actionControl={
            <FinalizeVerdictButton
              action={action('finalize_verdict', 'anyone', task.id)}
              disabled={false}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await canvas.findByRole('region', { name: 'Verdict and decision evidence' })
    ).toHaveTextContent('920 / 1000');
    await userEvent.click(canvas.getByRole('button', { name: 'Finalize verdict' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveTextContent('No X402 payment is required');
    await expect(dialog).toHaveTextContent('irreversible');
    await expect(dialog).toHaveTextContent('only available after the appeal deadline');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalize verdict' }));
    await expect(await canvas.findByText('Verdict finalized')).toBeVisible();
  },
};

export const PermissionlessFinalizationStale: Story = {
  render: () => {
    const task = recordedVerdictTask({ id: 'task-finalize-stale', status: 'completed' });
    return (
      <StoryWallet address={addresses.workerB}>
        <DecisionSurface
          actionControl={
            <FinalizeVerdictButton
              action={action('finalize_verdict', 'anyone', task.id)}
              disabled
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText('Approved')).length).toBeGreaterThan(0);
    await expect(canvas.getByRole('button', { name: 'Finalize verdict' })).toBeDisabled();
  },
};

export const DisputeResolutionConfirmationDark: Story = {
  globals: { theme: 'dark' },
  render: () => {
    const task = recordedVerdictTask({
      disputeResolver: addresses.workerB,
      id: 'task-resolve',
      status: 'disputed',
    });
    return (
      <StoryWallet address={addresses.workerB}>
        <DecisionSurface
          actionControl={
            <ResolveDisputeButton
              action={action('resolve_dispute', 'dispute_resolver', task.id)}
              disabled={false}
              task={task}
            />
          }
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await canvas.findByRole('region', { name: 'Verdict and decision evidence' })
    ).toHaveTextContent('Dispute resolver');
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve dispute' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveTextContent('costs 0.001 USDC and is irreversible');
    await expect(dialog).toHaveTextContent('immediately settles the listed awards');
    await expect(dialog).toHaveTextContent('opens no further appeal window');
  },
};

export const DisconnectedDecisionMaker: Story = {
  render: () => {
    const task = evaluationTask({ id: 'task-disconnected' });
    return (
      <StoryWallet address={addresses.evaluator} connected={false}>
        <EvaluateButton
          action={action('evaluate', 'evaluator', task.id)}
          disabled={false}
          task={task}
        />
      </StoryWallet>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText('Connect the assigned decision-maker wallet to continue.')
    ).toBeVisible();
  },
};
