// storybook-coverage: components/market/actions/accept-button.tsx
// storybook-coverage: components/market/actions/auction-accept-button.tsx
// storybook-coverage: components/market/actions/bid-form.tsx
// storybook-coverage: components/market/actions/cancel-button.tsx
// storybook-coverage: components/market/actions/claim-button.tsx
// storybook-coverage: components/market/actions/confirm-dialog.tsx
// storybook-coverage: components/market/actions/connect-prompt.tsx
// storybook-coverage: components/market/actions/forfeit-button.tsx
// storybook-coverage: components/market/actions/pitch-form.tsx
// storybook-coverage: components/market/actions/proof-form.tsx
// storybook-coverage: components/market/actions/rate-form.tsx
// storybook-coverage: components/market/actions/refund-expired-button.tsx
// storybook-coverage: components/market/actions/reject-submission-button.tsx
// storybook-coverage: components/market/actions/select-winner-button.tsx
// storybook-coverage: components/market/actions/select-worker-picker.tsx
// storybook-coverage: components/market/actions/split-acceptance-guide.tsx
// storybook-coverage: components/market/actions/submission-payout-action.tsx
// storybook-coverage: components/market/actions/submit-artifacts-form.tsx
// storybook-coverage: components/market/actions/update-form.tsx
// storybook-coverage: components/market/fund-wallet-button.tsx
// storybook-coverage: components/market/dreams-rewards-card.tsx
// storybook-coverage: components/market/task-actions-panel.tsx

import type { PendingAction } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect, type ReactNode } from 'react';
import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, useAccount, useConnect, WagmiProvider } from 'wagmi';
import { mock } from 'wagmi/connectors';

import { AcceptButton } from '@/components/market/actions/accept-button';
import { AuctionAcceptButton } from '@/components/market/actions/auction-accept-button';
import { BidForm } from '@/components/market/actions/bid-form';
import { CancelButton } from '@/components/market/actions/cancel-button';
import { ClaimButton } from '@/components/market/actions/claim-button';
import { ConfirmDialog } from '@/components/market/actions/confirm-dialog';
import { ConnectPrompt } from '@/components/market/actions/connect-prompt';
import { ForfeitButton } from '@/components/market/actions/forfeit-button';
import { PitchForm } from '@/components/market/actions/pitch-form';
import { ProofForm } from '@/components/market/actions/proof-form';
import { RateForm } from '@/components/market/actions/rate-form';
import { RefundExpiredButton } from '@/components/market/actions/refund-expired-button';
import { RejectSubmissionButton } from '@/components/market/actions/reject-submission-button';
import { SelectWinnerButton } from '@/components/market/actions/select-winner-button';
import { SelectWorkerPicker } from '@/components/market/actions/select-worker-picker';
import { SplitAcceptanceGuide } from '@/components/market/actions/split-acceptance-guide';
import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import { SubmitArtifactsForm } from '@/components/market/actions/submit-artifacts-form';
import { UpdateForm } from '@/components/market/actions/update-form';
import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { DreamsRewardsCard } from '@/components/market/dreams-rewards-card';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { addresses, taskDetailFixture } from './fixtures';

function ActionsCatalog() {
  return <div>Taskmarket task actions</div>;
}

const meta = {
  component: ActionsCatalog,
  title: 'Product/Task actions',
} satisfies Meta<typeof ActionsCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const connectedConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [mock({ accounts: [addresses.requester] })],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});

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

function ConnectedRequester({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WagmiProvider config={connectedConfig} reconnectOnMount={false}>
      <ConnectStoryWallet>{children}</ConnectStoryWallet>
    </WagmiProvider>
  );
}

function pendingAction(
  action: PendingAction['action'],
  role: PendingAction['role'],
  command: string,
  overrides: Partial<PendingAction> = {}
): PendingAction {
  return { action, command, role, ...overrides };
}

const acceptAction = pendingAction(
  'accept',
  'requester',
  `taskmarket task accept task-1 --worker ${addresses.worker}`,
  { targetWorker: addresses.worker }
);
const sharedTask = taskDetailFixture({
  claimedBy: addresses.worker,
  id: 'task-1',
  pendingActions: [],
  status: 'pending_approval',
  submissionCount: 2,
});

function ActionSurface({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export const DisconnectedPrompts: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-5 md:grid-cols-2">
      <ConnectPrompt />
      <ConnectPrompt label="Connect the requester wallet to release payout." />
      <SubmissionPayoutAction action={acceptAction} task={sharedTask} />
      <TaskActionsPanel
        emptyReason="No actions are available for this task state."
        pendingActions={[acceptAction]}
        requester={addresses.requester}
        task={sharedTask}
      />
    </div>
  ),
};

export const RequesterActionVariants: Story = {
  render: () => (
    <ConnectedRequester>
      <div className="grid max-w-6xl gap-5 md:grid-cols-2">
        <ActionSurface title="Release payout">
          <AcceptButton action={acceptAction} disabled task={sharedTask} />
        </ActionSurface>
        <ActionSurface title="Cancel task">
          <CancelButton
            action={pendingAction('cancel', 'requester', 'taskmarket task cancel task-1')}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Update task">
          <UpdateForm
            action={pendingAction('update', 'requester', 'taskmarket task update task-1')}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Rate worker">
          <RateForm
            action={pendingAction('rate', 'requester', 'taskmarket task rate task-1', {
              targetWorker: addresses.worker,
            })}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Reject worker submissions">
          <RejectSubmissionButton
            action={pendingAction(
              'reject_submission',
              'requester',
              `taskmarket task reject-submission task-1 --worker ${addresses.worker}`
            )}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Split acceptance">
          <SplitAcceptanceGuide action={acceptAction} disabled task={sharedTask} />
        </ActionSurface>
        <ActionSurface title="DREAMS reward balance">
          <DreamsRewardsCard />
        </ActionSurface>
      </div>
    </ConnectedRequester>
  ),
};

export const WorkerActionVariants: Story = {
  render: () => (
    <ConnectedRequester>
      <div className="grid max-w-6xl gap-5 md:grid-cols-2">
        <ActionSurface title="Claim bounty">
          <ClaimButton
            action={pendingAction('claim', 'worker', 'taskmarket task claim task-1')}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Place auction bid">
          <BidForm
            action={pendingAction('bid', 'worker', 'taskmarket task bid task-1 --price 100')}
            disabled
            task={taskDetailFixture({
              ...sharedTask,
              bidDeadline: '2099-08-05T00:00:00.000Z',
              mode: 'auction',
            })}
          />
        </ActionSurface>
        <ActionSurface title="Submit pitch">
          <PitchForm
            action={pendingAction('pitch', 'worker', 'taskmarket task pitch task-1')}
            disabled
            task={taskDetailFixture({
              ...sharedTask,
              mode: 'pitch',
              pitchDeadline: '2099-08-05T00:00:00.000Z',
            })}
          />
        </ActionSurface>
        <ActionSurface title="Submit benchmark proof">
          <ProofForm
            action={pendingAction('submit_proof', 'worker', 'taskmarket task proof task-1')}
            disabled
            task={taskDetailFixture({
              ...sharedTask,
              metricDescription: 'F1 score',
              metricTarget: '0.92',
              mode: 'benchmark',
            })}
          />
        </ActionSurface>
        <ActionSurface title="Submit artifacts">
          <SubmitArtifactsForm
            action={pendingAction('submit', 'worker', 'taskmarket task submit task-1')}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
        <ActionSurface title="Forfeit claim">
          <ForfeitButton
            action={pendingAction('forfeit', 'worker', 'taskmarket task forfeit task-1')}
            disabled
            task={sharedTask}
          />
        </ActionSurface>
      </div>
    </ConnectedRequester>
  ),
};

export const AuctionAndExpiryActions: Story = {
  render: () => (
    <ConnectedRequester>
      <div className="grid max-w-5xl gap-5 md:grid-cols-2">
        <ActionSurface title="Accept live auction price">
          <AuctionAcceptButton
            action={pendingAction(
              'auction_accept',
              'worker',
              'taskmarket task auction-accept task-1'
            )}
            disabled
            task={taskDetailFixture({
              ...sharedTask,
              auctionType: 'dutch',
              bidDeadline: '2099-08-05T00:00:00.000Z',
              currentAuctionPrice: '180000000',
              mode: 'auction',
            })}
          />
        </ActionSurface>
        <ActionSurface title="Select auction winner">
          <SelectWinnerButton
            action={pendingAction(
              'select_winner',
              'requester',
              'taskmarket task select-winner task-1'
            )}
            disabled
            task={taskDetailFixture({
              ...sharedTask,
              auctionType: 'english',
              bidDeadline: '2026-07-30T00:00:00.000Z',
              mode: 'auction',
            })}
          />
        </ActionSurface>
        <ActionSurface title="Select pitch worker">
          <SelectWorkerPicker
            action={pendingAction(
              'select_worker',
              'requester',
              'taskmarket task select-worker task-1'
            )}
            disabled
            task={taskDetailFixture({ ...sharedTask, mode: 'pitch' })}
          />
        </ActionSurface>
        <ActionSurface title="Refund expired task">
          <RefundExpiredButton
            action={pendingAction(
              'refund_expired',
              'requester',
              'taskmarket task refund-expired task-1'
            )}
            disabled
            task={taskDetailFixture({ ...sharedTask, status: 'expired' })}
          />
        </ActionSurface>
      </div>
    </ConnectedRequester>
  ),
};

export const ConfirmationAndFunding: Story = {
  render: () => (
    <div className="grid max-w-lg gap-6">
      <ConfirmDialog
        confirmCta="Delete draft"
        description="This permanently removes the local draft."
        onConfirm={async () => undefined}
        title="Delete this draft?"
      >
        <Button variant="destructive">Delete draft</Button>
      </ConfirmDialog>
      <FundWalletButton address={addresses.requester} fullWidth />
      <FundWalletButton fullWidth />
    </div>
  ),
};
