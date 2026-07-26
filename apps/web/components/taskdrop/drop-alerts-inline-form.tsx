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

/**
 * The signup that sits inline in the Task Drops page's "NEVER MISS A DROP" step. Same official
 * subscription as /taskdrop/alerts, in the page's green field: the message slot under the form
 * carries both outcomes, so the form itself stays put instead of being replaced.
 */
export function DropAlertsInlineForm() {
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

  const message =
    state === 'success'
      ? 'You’re subscribed. The next official Task Drop launch will land here.'
      : state === 'error'
        ? error
        : '';

  return (
    <>
      <form
        className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-[#16602D] bg-[#1E7A3A] p-2"
        onSubmit={submit}
      >
        <label className="sr-only" htmlFor="taskdrop-email">
          Email address
        </label>
        <input
          aria-describedby={state === 'error' ? 'taskdrop-email-error' : undefined}
          aria-invalid={state === 'error'}
          className="min-h-11 min-w-0 flex-1 basis-[150px] rounded-lg border-0 bg-transparent px-2 py-2 text-[15px] text-white placeholder:text-white/90 focus:ring-2 focus:ring-[#FFF6E8] focus:outline-none"
          id="taskdrop-email"
          name="email"
          onChange={(event) => {
            setEmail(event.target.value);
            if (state === 'error') setState('idle');
          }}
          placeholder="you@email.com"
          required
          type="email"
          value={email}
        />
        <button
          className="taskdrop-display min-h-11 shrink-0 cursor-pointer rounded-lg border-0 bg-[#E74079] px-4 pt-[11px] pb-2 text-lg tracking-[0.05em] text-[#FFF6E8]"
          disabled={subscribeMutation.isPending}
          type="submit"
        >
          SIGN ME UP
        </button>
      </form>
      <p
        aria-live="polite"
        className="mt-1.5 min-h-5 text-[12.5px] opacity-90"
        id={state === 'error' ? 'taskdrop-email-error' : undefined}
      >
        {message}
      </p>
    </>
  );
}
