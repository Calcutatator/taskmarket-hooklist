'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/api/client';

const OFFICIAL_SUBSCRIPTION_STORAGE_KEY = 'taskmarket:official-task-drop-subscription';

function dropSubscriptionStorageKey(taskDropId: string) {
  return `taskmarket:task-drop-subscription:${taskDropId}`;
}

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function TaskDropSubscribeForm({
  isOfficial,
  taskDropId,
}: {
  isOfficial: boolean;
  taskDropId: string;
}) {
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscribeMutation = trpc.taskDrops.subscribe.useMutation();
  const subscribeOfficialMutation = trpc.taskDrops.subscribeOfficial.useMutation();
  const statusQuery = trpc.taskDrops.status.useQuery(
    { email: savedEmail, taskDropId },
    { enabled: Boolean(savedEmail), refetchOnWindowFocus: false }
  );
  const officialStatusQuery = trpc.taskDrops.officialStatus.useQuery(
    { email: savedEmail },
    { enabled: isOfficial && Boolean(savedEmail), refetchOnWindowFocus: false }
  );

  useEffect(() => {
    const exactEmail = readStorage(dropSubscriptionStorageKey(taskDropId));
    const storedEmail = isOfficial
      ? readStorage(OFFICIAL_SUBSCRIPTION_STORAGE_KEY) || exactEmail
      : exactEmail;
    setSavedEmail(storedEmail);
    setEmail(isOfficial && !readStorage(OFFICIAL_SUBSCRIPTION_STORAGE_KEY) ? exactEmail : '');
    setMessage(null);
    setError(null);
  }, [isOfficial, taskDropId]);

  useEffect(() => {
    if (!savedEmail) return;

    if (isOfficial) {
      if (officialStatusQuery.data?.subscribed) {
        setMessage('This email is subscribed to all official Task Drops.');
        return;
      }
      if (statusQuery.data?.subscribed) {
        setMessage(
          'This email follows only this drop. Subscribe to get future official Task Drop launches.'
        );
        return;
      }
      if (officialStatusQuery.data === undefined || statusQuery.data === undefined) return;

      try {
        window.localStorage.removeItem(OFFICIAL_SUBSCRIPTION_STORAGE_KEY);
        window.localStorage.removeItem(dropSubscriptionStorageKey(taskDropId));
      } catch {
        // Keep the form usable when browser storage is unavailable.
      }
      setSavedEmail('');
      return;
    }

    if (statusQuery.data === undefined) return;
    if (statusQuery.data.subscribed) {
      setMessage('This email is already following this drop.');
      return;
    }

    try {
      window.localStorage.removeItem(dropSubscriptionStorageKey(taskDropId));
    } catch {
      // Keep the form usable when browser storage is unavailable.
    }
    setSavedEmail('');
  }, [isOfficial, officialStatusQuery.data, savedEmail, statusQuery.data, taskDropId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      if (isOfficial) {
        const result = await subscribeOfficialMutation.mutateAsync({
          email,
          source: 'official_drop_page',
        });
        setMessage(
          result.alreadySubscribed
            ? 'This email is already subscribed to all official Task Drops.'
            : 'Subscribed to future official Task Drop launches.'
        );
        try {
          window.localStorage.setItem(OFFICIAL_SUBSCRIPTION_STORAGE_KEY, result.email);
          window.localStorage.removeItem(dropSubscriptionStorageKey(taskDropId));
        } catch {
          // The active subscription still succeeds when browser storage is unavailable.
        }
        setSavedEmail(result.email);
      } else {
        const result = await subscribeMutation.mutateAsync({
          email,
          source: 'drop_page',
          taskDropId,
        });
        setMessage(
          result.alreadySubscribed
            ? 'This email is already following this drop.'
            : 'Subscribed to this drop.'
        );
        try {
          window.localStorage.setItem(dropSubscriptionStorageKey(taskDropId), result.email);
        } catch {
          // The active subscription still succeeds when browser storage is unavailable.
        }
        setSavedEmail(result.email);
      }
      setEmail('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isOfficial
            ? 'Could not subscribe to official Task Drops.'
            : 'Could not subscribe to this drop.'
      );
    }
  }

  const isPending = subscribeMutation.isPending || subscribeOfficialMutation.isPending;

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor={`task-drop-email-${taskDropId}`}>Email</Label>
        <Input
          aria-describedby={error ? `task-drop-subscribe-error-${taskDropId}` : undefined}
          aria-invalid={Boolean(error)}
          id={`task-drop-email-${taskDropId}`}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </div>
      <Button disabled={isPending || !email.trim()} type="submit">
        {isPending ? 'Subscribing...' : isOfficial ? 'Get official drops' : 'Subscribe'}
      </Button>
      {message ? <p className="text-sm text-success">{message}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" id={`task-drop-subscribe-error-${taskDropId}`}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
