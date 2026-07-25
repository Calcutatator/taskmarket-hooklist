'use client';

import { useState } from 'react';

export function DropAlertsForm() {
  const [message, setMessage] = useState('');

  // TODO(Loaf): Replace this preview-only handler when the email backend is ready.
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('Drop alerts are coming soon.');
  }

  return (
    <>
      <form
        className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-[#16602D] bg-[#1E7A3A] p-2"
        onSubmit={submit}
      >
        <label className="sr-only" htmlFor="taskdrop-b-email">
          Email address
        </label>
        <input
          className="min-h-11 min-w-0 flex-1 basis-[150px] rounded-lg border-0 bg-transparent px-2 py-2 text-[15px] text-white placeholder:text-white/90 focus:ring-2 focus:ring-[#FFF6E8] focus:outline-none"
          id="taskdrop-b-email"
          name="email"
          placeholder="you@email.com"
          required
          type="email"
        />
        <button
          className="taskdrop-b-display min-h-11 shrink-0 cursor-pointer rounded-lg border-0 bg-[#E74079] px-4 pt-[11px] pb-2 text-lg tracking-[0.05em] text-[#FFF6E8]"
          type="submit"
        >
          SIGN ME UP
        </button>
      </form>
      <p aria-live="polite" className="mt-1.5 min-h-5 text-[12.5px] opacity-90">
        {message}
      </p>
    </>
  );
}
