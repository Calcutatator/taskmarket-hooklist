'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { LockKeyhole } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { TaskDetailResponse } from '@taskmarket/shared';

import { Button } from '@/components/ui/button';
import { PrivyWalletAccessButton } from '@/components/privy-account-control';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CallerScopedTaskDetail } from '@/components/market/caller-scoped-task-detail';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { CLIENT_AUTH_STATE_CLEARED_EVENT } from '@/lib/clear-client-auth-state';
import { getCachedReadAuthHeaders } from '@/lib/read-auth';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';
import {
  getCachedTaskAccessGrantHeaders,
  setCachedTaskAccessGrant,
} from '@/lib/task-access-grants';

/**
 * Phase 3 (ADR-0031/0031): rendered inline by the task-detail page components in place
 * of `notFound()` when `fetchTask`'s unauthenticated SSR fetch returns null -- either the
 * task genuinely doesn't exist, or it's private and this caller can't view it yet.
 * Deliberately does not distinguish the two cases (matching canView's own posture). A
 * caller with no proof of access sees one neutral unavailable state, plus wallet and
 * password recovery paths that only succeed when the task exists and the caller is
 * authorized. Once either proof succeeds, this refetches the task client-side and renders
 * the normal detail view in its place.
 *
 * Uses its own one-off `fetch` rather than the shared batched tRPC client
 * (api/client.tsx) -- that client's `httpBatchLink` isn't call-aware, so it can't
 * attach a grant header scoped to just this one taskId if another query ever batched
 * alongside it. A single unbatched request keeps this gate's headers unambiguous.
 */
// Implements: ADR-0031 (client-side gate, not persisted SSR wallet session)
export function PrivateTaskAccessGate({
  taskId,
  backHref,
  profileBasePath,
  browseTasksHref,
  browseAgentsHref,
}: {
  taskId: string;
  backHref: string;
  profileBasePath: string;
  browseTasksHref: string;
  browseAgentsHref: string;
}) {
  const { address, isConnected } = useAccount();
  const readAuth = useReadAuthSignatureState(address, { autoStart: false });
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingWallet, setCheckingWallet] = useState(false);
  const [walletAccessError, setWalletAccessError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskDetailResponse | null>(null);

  useEffect(() => {
    setWalletAccessError(null);
    setTask(null);
  }, [address]);

  useEffect(() => {
    const clearRenderedPrivateTask = () => setTask(null);
    window.addEventListener(CLIENT_AUTH_STATE_CLEARED_EVENT, clearRenderedPrivateTask);
    return () =>
      window.removeEventListener(CLIENT_AUTH_STATE_CLEARED_EVENT, clearRenderedPrivateTask);
  }, []);

  const attemptFetch = useCallback(async () => {
    const headers = {
      ...getCachedReadAuthHeaders(),
      ...getCachedTaskAccessGrantHeaders(taskId),
    };
    try {
      const res = await fetch(`${getBrowserApiBaseUrl()}/api/tasks/${taskId}`, {
        headers: { accept: 'application/json', ...headers },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as TaskDetailResponse | null;
      if (!body) return false;
      setTask(body);
      return true;
    } catch {
      return false;
    }
  }, [taskId]);

  const checkWalletAccess = useCallback(async () => {
    setCheckingWallet(true);
    setWalletAccessError(null);
    const found = await attemptFetch();
    if (!found) {
      setWalletAccessError(
        'We could not load private task access for this wallet. Switch wallets or try again.'
      );
    }
    setCheckingWallet(false);
  }, [attemptFetch]);

  // Once a wallet signature lands, try the gated fetch.
  useEffect(() => {
    if (readAuth.ready) {
      void checkWalletAccess();
    }
  }, [readAuth.ready, checkWalletAccess]);

  const handleUnlock = async () => {
    setUnlocking(true);
    setError(null);
    try {
      const res = await fetch(
        `${getBrowserApiBaseUrl()}/api/tasks/${taskId}/private-access/verify`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId, password }),
        }
      );
      const body = (await res.json()) as {
        grant?: string;
        expiresAt?: string;
        message?: string;
      };
      if (!res.ok || !body.grant) {
        setError(body.message ?? 'Incorrect password.');
        return;
      }
      setCachedTaskAccessGrant(taskId, body.grant, body.expiresAt);
      const found = await attemptFetch();
      if (!found) {
        setError('Unlocked, but the task could not be loaded. Try refreshing.');
      }
    } catch {
      setError('Failed to unlock task. Try again.');
    } finally {
      setUnlocking(false);
    }
  };

  if (task) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <CallerScopedTaskDetail backHref={backHref} profileBasePath={profileBasePath} task={task} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <section className="w-full overflow-hidden rounded-lg border border-border/58 bg-card/58">
        <header className="grid gap-4 p-6 sm:p-8">
          <div className="grid size-11 place-items-center rounded-lg border border-border/58 bg-muted/24 text-primary">
            <LockKeyhole aria-hidden="true" className="size-5" />
          </div>
          <div className="grid gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Task unavailable
            </h1>
            <p className="text-base leading-7 text-muted-foreground">
              This link may be invalid, or the task may require access. Use an invited wallet or
              task password to continue.
            </p>
          </div>
        </header>

        <div className="grid gap-6 border-t border-border/58 p-6 sm:p-8">
          <section aria-labelledby="wallet-access-heading" className="grid gap-3">
            <div className="grid gap-1">
              <h2 className="font-display font-semibold text-foreground" id="wallet-access-heading">
                Use an invited wallet
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Sign in, then choose the wallet that received the invitation.
              </p>
            </div>
            {!isConnected || !address ? (
              <PrivyWalletAccessButton
                className="min-h-11 w-fit"
                returnTargetId="private-task-access"
              />
            ) : (
              <div className="grid gap-2">
                {readAuth.status === 'ready' ? (
                  <p className="text-sm text-muted-foreground">
                    {checkingWallet
                      ? 'Wallet verified. Checking task access...'
                      : 'Wallet verified.'}
                  </p>
                ) : null}
                {readAuth.error ? (
                  <p className="text-sm leading-6 text-destructive">{readAuth.error}</p>
                ) : null}
                {walletAccessError ? (
                  <p className="text-sm leading-6 text-destructive">{walletAccessError}</p>
                ) : null}
                <Button
                  className="min-h-11 w-fit"
                  disabled={
                    readAuth.status === 'signing' ||
                    checkingWallet ||
                    (readAuth.status === 'ready' && !walletAccessError)
                  }
                  onClick={
                    readAuth.status === 'ready' ? checkWalletAccess : readAuth.requestSignature
                  }
                  type="button"
                  variant="outline"
                >
                  {checkingWallet
                    ? 'Checking task access...'
                    : readAuth.status === 'signing'
                      ? 'Check your wallet...'
                      : readAuth.status === 'ready' && walletAccessError
                        ? 'Retry task access'
                        : readAuth.status === 'error'
                          ? 'Retry wallet verification'
                          : 'Verify wallet access'}
                </Button>
              </div>
            )}
          </section>

          <section
            aria-labelledby="password-access-heading"
            className="grid gap-3 border-t border-border/58 pt-6"
          >
            <div className="grid gap-1">
              <h2
                className="font-display font-semibold text-foreground"
                id="password-access-heading"
              >
                Enter a task password
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Use the password supplied by the requester.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unlock-password">Task password</Label>
              <Input
                id="unlock-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
            {error ? <p className="text-sm leading-6 text-destructive">{error}</p> : null}
            <Button
              className="min-h-11 w-fit"
              disabled={unlocking || !password}
              onClick={handleUnlock}
              type="button"
            >
              {unlocking ? 'Unlocking...' : 'Unlock task'}
            </Button>
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-border/58 px-6 py-4 sm:px-8">
          <Button asChild variant="outline">
            <Link href={browseTasksHref as Route}>Browse tasks</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={browseAgentsHref as Route}>Browse agents</Link>
          </Button>
        </footer>
      </section>
    </div>
  );
}
