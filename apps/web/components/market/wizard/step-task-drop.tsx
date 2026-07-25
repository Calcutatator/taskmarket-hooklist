'use client';

import type { UseFormReturn } from 'react-hook-form';
import { useAccount } from 'wagmi';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api/client';
import type { WalletAccessStatus } from '@/components/privy-account-control';
import { handleRadioGroupKeyDown, type CreateTaskFieldErrors } from '@/lib/market/create-task-form';
import { cn } from '@/lib/utils';

import type { WizardFormValues } from '../create-task-wizard';

const dropModes = [
  {
    value: 'none',
    title: 'No drop',
    description: 'Publish this as a standalone task.',
  },
  {
    value: 'existing',
    title: 'Existing drop',
    description: 'Notify followers of a drop you own.',
  },
  {
    value: 'new',
    title: 'Create new drop',
    description: 'Start a work stream while publishing this task.',
  },
] as const;

type DropMode = (typeof dropModes)[number]['value'];

export function StepTaskDrop({
  beginWalletAccess,
  fieldErrors,
  form,
  walletActionStatus,
}: {
  beginWalletAccess: (returnTargetId?: string) => void;
  fieldErrors: CreateTaskFieldErrors;
  form: UseFormReturn<WizardFormValues>;
  walletActionStatus: WalletAccessStatus | 'unavailable';
}) {
  const { address, isConnected } = useAccount();
  const taskDropMode = form.watch('taskDropMode');
  const taskDropId = form.watch('taskDropId');
  const dropsQuery = trpc.taskDrops.listByOwner.useQuery(
    { ownerAddress: address ?? '' },
    {
      enabled: Boolean(isConnected && address),
      refetchOnWindowFocus: false,
    }
  );
  const drops = dropsQuery.data ?? [];
  const walletAccessPending =
    walletActionStatus === 'initializing' || walletActionStatus === 'wallet-loading';
  const walletButtonLabel =
    walletActionStatus === 'signed-out'
      ? 'Sign in to load drops'
      : walletActionStatus === 'initializing'
        ? 'Loading sign in'
        : walletActionStatus === 'wallet-loading'
          ? 'Loading wallet'
          : 'Connect wallet to load drops';

  function selectMode(value: DropMode) {
    const previousMode = form.getValues('taskDropMode');
    form.setValue('taskDropMode', value, { shouldDirty: true, shouldValidate: false });
    if (value !== 'existing') {
      form.setValue('taskDropId', '', { shouldDirty: true, shouldValidate: false });
    }
    if (value !== 'new' || previousMode === 'existing') {
      form.setValue('taskDropName', '', { shouldDirty: true, shouldValidate: false });
      form.setValue('taskDropDescription', '', { shouldDirty: true, shouldValidate: false });
    }
  }

  function selectExistingDrop(drop: (typeof drops)[number]) {
    form.setValue('taskDropId', drop.id, {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue('taskDropName', drop.name, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Task Drop</CardTitle>
          <CardDescription>
            Choose whether this task belongs to a subscriber-facing drop.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div
            aria-label="Task Drop mode"
            className="grid gap-3 sm:grid-cols-3"
            onKeyDown={(event) =>
              handleRadioGroupKeyDown(
                event,
                dropModes.map((mode) => mode.value),
                taskDropMode,
                (value) => selectMode(value as DropMode)
              )
            }
            role="radiogroup"
          >
            {dropModes.map((mode) => {
              const selected = taskDropMode === mode.value;
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    'grid min-h-28 gap-2 rounded-lg border p-4 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/68 bg-background/50 hover:border-primary/45'
                  )}
                  key={mode.value}
                  onClick={() => selectMode(mode.value)}
                  role="radio"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  <span className="font-sans text-sm font-semibold">{mode.title}</span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {mode.description}
                  </span>
                </button>
              );
            })}
          </div>

          {taskDropMode === 'existing' ? (
            <div className="grid gap-3">
              {!isConnected ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-border/68 bg-surface/42 p-3 text-sm leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <p>Connect your wallet before publishing to load drops you own.</p>
                  <Button
                    disabled={walletAccessPending || walletActionStatus === 'unavailable'}
                    id="task-drop-wallet-access"
                    onClick={() => beginWalletAccess('task-drop-wallet-access')}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {walletButtonLabel}
                  </Button>
                </div>
              ) : null}
              {isConnected && drops.length === 0 ? (
                <p className="rounded-lg border border-border/68 bg-surface/42 p-3 text-sm leading-5 text-muted-foreground">
                  No owned drops found for this wallet. Create a new drop instead.
                </p>
              ) : null}
              {drops.length > 0 ? (
                <div
                  aria-label="Owned Task Drops"
                  className="grid gap-2"
                  onKeyDown={(event) =>
                    handleRadioGroupKeyDown(
                      event,
                      drops.map((drop) => drop.id),
                      taskDropId,
                      (value) => {
                        const drop = drops.find((candidate) => candidate.id === value);
                        if (drop) {
                          selectExistingDrop(drop);
                        }
                      }
                    )
                  }
                  role="radiogroup"
                >
                  {drops.map((drop, index) => {
                    const selected = taskDropId === drop.id;
                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'flex items-start justify-between gap-3 rounded-lg border p-3 text-left',
                          selected ? 'border-primary bg-primary/10' : 'border-border/68'
                        )}
                        key={drop.id}
                        onClick={() => selectExistingDrop(drop)}
                        role="radio"
                        tabIndex={selected || (!taskDropId && index === 0) ? 0 : -1}
                        type="button"
                      >
                        <span className="grid gap-1">
                          <span className="font-sans text-sm font-semibold">{drop.name}</span>
                          {drop.description ? (
                            <span className="text-xs leading-5 text-muted-foreground">
                              {drop.description}
                            </span>
                          ) : null}
                        </span>
                        <Badge variant={selected ? 'default' : 'outline'}>
                          {selected ? 'Selected' : 'Choose'}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {fieldErrors.taskDropId ? (
                <p className="text-sm text-destructive">{fieldErrors.taskDropId}</p>
              ) : null}
            </div>
          ) : null}

          {taskDropMode === 'new' ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="taskDropName">Drop name</Label>
                <Input
                  aria-invalid={Boolean(fieldErrors.taskDropName)}
                  id="taskDropName"
                  maxLength={80}
                  {...form.register('taskDropName')}
                />
                {fieldErrors.taskDropName ? (
                  <p className="text-sm text-destructive">{fieldErrors.taskDropName}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="taskDropDescription">Description</Label>
                <Textarea
                  id="taskDropDescription"
                  maxLength={500}
                  rows={4}
                  {...form.register('taskDropDescription')}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
