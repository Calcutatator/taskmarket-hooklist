'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
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
 * Deliberately does not distinguish the two cases (matching canView's own posture), so
 * this renders the exact same branded not-found content as the site's generic
 * `app/not-found.tsx` -- a caller with no proof of access sees nothing different from a
 * truly missing task -- plus, below it, "connect wallet" (reusing the existing read-auth
 * signature flow) and "enter password" affordances that only matter if the task actually
 * exists and is private. Once either proof succeeds, this refetches the task
 * client-side and renders the normal detail view in its place.
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
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="w-full rounded-lg border border-border/58 bg-card/58 p-8 shadow-none sm:p-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-tight text-primary">404</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We could not find what you were looking for. It may have been moved, removed, or never
          existed. Browse the marketplace instead.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href={browseTasksHref as Route}>Browse tasks</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={browseAgentsHref as Route}>Browse agents</Link>
          </Button>
        </div>

        <div className="mt-8 grid gap-3 border-t border-border/58 pt-8 text-left">
          <p className="text-sm text-muted-foreground">
            If you were invited to a private task at this link, sign in, then choose the wallet that
            received the invitation. You can also enter the task password below.
          </p>
          {!isConnected || !address ? (
            <div className="grid gap-2">
              <p className="text-xs leading-5 text-muted-foreground">
                Sign in with email, Google, or a wallet. Access still requires the wallet that
                received the invitation.
              </p>
              <PrivyWalletAccessButton
                className="min-h-11 w-fit"
                returnTargetId="private-task-access"
              />
            </div>
          ) : (
            <div className="grid gap-2">
              {readAuth.status === 'ready' ? (
                <p className="text-xs text-muted-foreground">
                  {checkingWallet
                    ? 'Wallet verified. Checking private task access...'
                    : 'Wallet verified.'}
                </p>
              ) : null}
              {readAuth.error ? (
                <p className="text-xs leading-5 text-destructive">{readAuth.error}</p>
              ) : null}
              {walletAccessError ? (
                <p className="text-xs leading-5 text-destructive">{walletAccessError}</p>
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
                  ? 'Checking private task access...'
                  : readAuth.status === 'signing'
                    ? 'Check your wallet...'
                    : readAuth.status === 'ready' && walletAccessError
                      ? 'Retry private task access'
                      : readAuth.status === 'error'
                        ? 'Retry wallet verification'
                        : 'Verify wallet access'}
              </Button>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="unlock-password">Password</Label>
            <Input
              id="unlock-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>
          {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}
          <Button
            className="w-fit"
            disabled={unlocking || !password}
            onClick={handleUnlock}
            type="button"
          >
            {unlocking ? 'Unlocking...' : 'Unlock'}
          </Button>
        </div>
      </div>
    </div>
  );
}
