'use client';

import { useEffect, useState } from 'react';

import { trpc } from '@/lib/api/client';

const OFFICIAL_SUBSCRIPTION_STORAGE_KEY = 'taskmarket:official-task-drop-subscription';

type FormState = 'error' | 'idle' | 'success';

function savedEmail(): string {
  try {
    return window.localStorage.getItem(OFFICIAL_SUBSCRIPTION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function DropAlertsForm() {
  const [email, setEmail] = useState('');
  const [persistedEmail, setPersistedEmail] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState('');
  const subscribeMutation = trpc.taskDrops.subscribeOfficial.useMutation();
  const statusQuery = trpc.taskDrops.officialStatus.useQuery(
    { email: persistedEmail },
    { enabled: Boolean(persistedEmail), refetchOnWindowFocus: false }
  );

  useEffect(() => {
    setPersistedEmail(savedEmail());
  }, []);

  useEffect(() => {
    if (!persistedEmail || statusQuery.data === undefined) return;
    if (statusQuery.data.subscribed) {
      setState('success');
      return;
    }
    try {
      window.localStorage.removeItem(OFFICIAL_SUBSCRIPTION_STORAGE_KEY);
    } catch {
      // Keep the form usable when browser storage is unavailable.
    }
    setPersistedEmail('');
  }, [persistedEmail, statusQuery.data]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setState('idle');

    try {
      const result = await subscribeMutation.mutateAsync({
        email,
        source: 'taskdrop_landing',
      });
      try {
        window.localStorage.setItem(OFFICIAL_SUBSCRIPTION_STORAGE_KEY, result.email);
      } catch {
        // The subscription remains active when browser storage is unavailable.
      }
      setPersistedEmail(result.email);
      setState('success');
      setEmail('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not subscribe. Please try again.');
      setState('error');
    }
  }

  if (state === 'success') {
    return (
      <p className="mt-5 text-[15px] font-semibold text-[var(--taskdrop-cream)]">
        You&rsquo;re subscribed. The next official Task Drop launch will land here.
      </p>
    );
  }

  return (
    <form className="mt-5 flex flex-wrap items-center justify-center gap-2.5" onSubmit={submit}>
      <label className="sr-only" htmlFor="drop-alerts-email">
        Email address
      </label>
      <input
        aria-describedby={state === 'error' ? 'drop-alerts-error' : undefined}
        aria-invalid={state === 'error'}
        className="w-72 rounded-md border-0 bg-[var(--taskdrop-cream)] px-4 py-3 text-sm text-[var(--taskdrop-ink)] placeholder:text-[var(--taskdrop-brown-muted)] focus:ring-2 focus:ring-[var(--taskdrop-pink)] focus:outline-none"
        id="drop-alerts-email"
        name="email"
        onChange={(event) => {
          setEmail(event.target.value);
          if (state === 'error') setState('idle');
        }}
        placeholder="you@wherever.dev"
        required
        type="email"
        value={email}
      />
      <button
        className="cursor-pointer rounded-md bg-[var(--taskdrop-pink)] px-5 py-3 text-sm font-bold tracking-wider text-[var(--taskdrop-cream)] uppercase transition-[filter] hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-65"
        disabled={subscribeMutation.isPending || !email.trim()}
        type="submit"
      >
        {subscribeMutation.isPending ? 'Signing up' : 'Sign me up'}
      </button>
      {state === 'error' ? (
        <p className="w-full text-[13px] text-[var(--taskdrop-heat)]" id="drop-alerts-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
