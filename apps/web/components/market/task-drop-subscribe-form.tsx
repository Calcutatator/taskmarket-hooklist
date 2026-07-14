'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/api/client';

function subscriptionStorageKey(taskDropId: string) {
  return `taskmarket:task-drop-subscription:${taskDropId}`;
}

function savedSubscriptionEmail(taskDropId: string): string {
  try {
    return window.localStorage.getItem(subscriptionStorageKey(taskDropId)) ?? '';
  } catch {
    return '';
  }
}

export function TaskDropSubscribeForm({ taskDropId }: { taskDropId: string }) {
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscribeMutation = trpc.taskDrops.subscribe.useMutation();
  const statusQuery = trpc.taskDrops.status.useQuery(
    { email: savedEmail, taskDropId },
    { enabled: Boolean(savedEmail), refetchOnWindowFocus: false }
  );

  useEffect(() => {
    const storedEmail = savedSubscriptionEmail(taskDropId);
    setSavedEmail(storedEmail);
    setMessage(null);
    setError(null);
  }, [taskDropId]);

  useEffect(() => {
    if (!savedEmail || statusQuery.data === undefined) return;

    if (statusQuery.data.subscribed) {
      setMessage('This email is already following this drop.');
      return;
    }

    try {
      window.localStorage.removeItem(subscriptionStorageKey(taskDropId));
    } catch {
      // Keep the form usable when browser storage is unavailable.
    }
    setSavedEmail('');
  }, [savedEmail, statusQuery.data, taskDropId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
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
        window.localStorage.setItem(subscriptionStorageKey(taskDropId), result.email);
      } catch {
        // The active subscription still succeeds when browser storage is unavailable.
      }
      setSavedEmail(result.email);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not subscribe to this drop.');
    }
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="task-drop-email">Email</Label>
        <Input
          aria-describedby={error ? 'task-drop-subscribe-error' : undefined}
          aria-invalid={Boolean(error)}
          id="task-drop-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
      </div>
      <Button disabled={subscribeMutation.isPending || !email.trim()} type="submit">
        {subscribeMutation.isPending ? 'Subscribing...' : 'Subscribe'}
      </Button>
      {message ? <p className="text-sm text-success">{message}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" id="task-drop-subscribe-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
