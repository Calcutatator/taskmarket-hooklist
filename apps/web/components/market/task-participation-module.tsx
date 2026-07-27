'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { BotIcon, UploadIcon, UserRoundIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';

import { SubmitArtifactsForm } from '@/components/market/actions/submit-artifacts-form';
import { CopyButton } from '@/components/market/copy-button';
import { SkillInstallSnippet } from '@/components/market/skill-install-snippet';
import {
  PrivyWalletAccessButton,
  usePrivyAccountState,
  type WalletAccessStatus,
} from '@/components/privy-account-control';
import { canViewAction, sameAddress } from '@/components/market/task-action-visibility';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  OPEN_MARKET_COMMAND,
  TASK_PARTICIPATION_COPY,
  skillDocumentUrl,
  skillInstallCommands,
} from '@/lib/skill';
import { isPrivyConfigured } from '@/lib/privy-config';

function CommandRow({ command, label }: { command: string; label: string }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="font-mono text-[0.65rem] uppercase text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/52 bg-background/68 p-2 pl-3">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
          {command}
        </code>
        <CopyButton label={`Copy ${label.toLowerCase()}`} text={command} />
      </div>
    </div>
  );
}

export function TaskParticipationModule({
  action,
  task,
}: {
  action: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address, isConnected } = useAccount();

  if (sameAddress(address, task.requester)) {
    return null;
  }

  if (!isPrivyConfigured()) {
    return (
      <TaskParticipationContent
        action={action}
        address={address}
        task={task}
        walletAccessStatus={isConnected && address ? 'connected' : 'unavailable'}
      />
    );
  }

  return <TaskParticipationModuleWithPrivy action={action} task={task} />;
}

function TaskParticipationModuleWithPrivy({
  action,
  task,
}: {
  action: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address, walletActionStatus } = usePrivyAccountState();

  if (sameAddress(address, task.requester)) {
    return null;
  }

  return (
    <TaskParticipationContent
      action={action}
      address={address}
      task={task}
      walletAccessStatus={walletActionStatus}
    />
  );
}

function TaskParticipationContent({
  action,
  address,
  task,
  walletAccessStatus,
}: {
  action: PendingAction;
  address?: string;
  task: TaskDetailResponse | TaskResponse;
  walletAccessStatus: WalletAccessStatus | 'unavailable';
}) {
  const router = useRouter();
  const canParticipate = canViewAction({
    action,
    address,
    claimedBy: task.claimedBy,
    requester: task.requester,
    worker: task.primaryAward?.workerAddress,
  });

  const isSubmit = action.action === 'submit';
  const hasWallet = walletAccessStatus === 'connected';
  const canSubmitInBrowser = isSubmit && hasWallet && canParticipate;
  const needsWalletForBrowserSubmit = isSubmit && !hasWallet;
  const showHumanPath = canSubmitInBrowser || needsWalletForBrowserSubmit;
  const skillUrl = skillDocumentUrl();
  const installCommands = skillInstallCommands({ source: 'task-detail', taskId: task.id });
  const setupHref =
    `/dashboard/for-agents?source=task-detail&taskId=${encodeURIComponent(task.id)}` as Route;

  return (
    <section
      aria-labelledby="task-participation-title"
      className="grid min-w-0 gap-4 border-t border-border/58 pt-5"
      data-testid="task-participation"
    >
      <div className="grid gap-2">
        <Badge className="w-fit" variant="terminal">
          Participate
        </Badge>
        <h2
          className="font-display text-xl font-semibold tracking-tight text-foreground"
          id="task-participation-title"
        >
          Want to take this on?
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {canSubmitInBrowser
            ? TASK_PARTICIPATION_COPY.submit
            : needsWalletForBrowserSubmit
              ? 'Connect a wallet to upload finished work from this browser, or use an agent to follow the task flow for you.'
              : TASK_PARTICIPATION_COPY.guided}
        </p>
        <Link
          className="w-fit font-mono text-xs uppercase text-muted-foreground hover:text-primary"
          href="/dashboard/task-types"
        >
          How this works
        </Link>
      </div>

      <div className={`grid min-w-0 gap-3 ${showHumanPath ? 'sm:grid-cols-2' : ''}`}>
        {showHumanPath ? (
          <article
            aria-labelledby="task-participation-human"
            className="grid min-w-0 content-between gap-5 rounded-lg border border-border/58 bg-surface/40 p-4"
          >
            <div className="grid gap-3">
              <span className="flex size-9 items-center justify-center rounded-full border border-border/58 bg-background/68 text-primary">
                <UserRoundIcon aria-hidden="true" className="size-4" />
              </span>
              <div className="grid gap-1">
                <h3
                  className="font-display font-semibold tracking-tight text-foreground"
                  id="task-participation-human"
                >
                  For humans
                </h3>
                <p className="text-sm leading-5 text-muted-foreground">
                  {canSubmitInBrowser
                    ? 'Upload finished files from this browser and send them for review.'
                    : 'Connect the wallet you will use for this task, then upload finished files for review.'}
                </p>
              </div>
            </div>
            {canSubmitInBrowser ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="w-full" type="button" variant="outline">
                    <UploadIcon aria-hidden="true" className="size-4" />
                    Upload files
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Submit work</DialogTitle>
                    <DialogDescription>
                      Add your deliverables, choose their roles, and submit them for requester
                      review.
                    </DialogDescription>
                  </DialogHeader>
                  <SubmitArtifactsForm
                    action={action}
                    disabled={false}
                    onSuccess={() => router.refresh()}
                    task={task}
                  />
                </DialogContent>
              </Dialog>
            ) : (
              <PrivyWalletAccessButton
                className="w-full"
                label="Connect wallet to upload"
                walletlessLabel="Connect wallet to upload"
              />
            )}
          </article>
        ) : null}

        <article
          aria-labelledby="task-participation-agent"
          className="grid min-w-0 content-between gap-5 rounded-lg border border-border/58 bg-surface/40 p-4"
        >
          <div className="grid gap-3">
            <span className="flex size-9 items-center justify-center rounded-full border border-border/58 bg-background/68 text-primary">
              <BotIcon aria-hidden="true" className="size-4" />
            </span>
            <div className="grid gap-1">
              <h3
                className="font-display font-semibold tracking-tight text-foreground"
                id="task-participation-agent"
              >
                For agents
              </h3>
              <p className="text-sm leading-5 text-muted-foreground">
                {TASK_PARTICIPATION_COPY.agent}
              </p>
            </div>
          </div>
          <Button asChild className="w-full">
            <Link
              data-analytics-event="task-participation-agent-setup"
              data-task-id={task.id}
              href={setupHref}
            >
              Set up an agent
            </Link>
          </Button>
        </article>
      </div>

      <details
        aria-label="For developers"
        className="group min-w-0 rounded-lg border border-border/58 bg-background/30 p-3"
        data-analytics-event="task-participation-developers-open"
        data-task-id={task.id}
      >
        <summary className="cursor-pointer select-none rounded-sm font-mono text-xs uppercase text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none">
          For developers
        </summary>
        <div className="mt-4 grid min-w-0 gap-4">
          <p className="text-sm leading-5 text-muted-foreground">
            Install the marketplace skill, then run the command for this task or browse other open
            work.
          </p>
          <SkillInstallSnippet commands={installCommands} defaultMethod="curl" />
          <CommandRow command={action.command} label="This task" />
          <CommandRow command={OPEN_MARKET_COMMAND} label="Browse open tasks" />
          <a
            className="w-fit font-mono text-xs uppercase text-primary hover:underline"
            href={skillUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open skill.md
          </a>
        </div>
      </details>
    </section>
  );
}
