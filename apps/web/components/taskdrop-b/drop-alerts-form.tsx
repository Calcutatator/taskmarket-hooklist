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
      <form className="mt-5 flex flex-wrap gap-2.5" onSubmit={submit}>
        <label className="sr-only" htmlFor="taskdrop-b-email">
          Email address
        </label>
        <input
          className="min-w-50 flex-1 rounded-[11px] border-0 bg-white px-4 py-3.5 text-[15px] text-[#2C1F1A] placeholder:text-[#2C1F1A]/60 focus:ring-2 focus:ring-[#FF3D7E] focus:outline-none"
          id="taskdrop-b-email"
          name="email"
          placeholder="you@email.com"
          required
          type="email"
        />
        <button
          className="taskdrop-b-display cursor-pointer rounded-[11px] border-0 bg-[#FFF6E8] px-[22px] pt-[15px] pb-3 text-xl tracking-[0.05em] text-[#2C1F1A]"
          type="submit"
        >
          SIGN ME UP
        </button>
      </form>
      <p aria-live="polite" className="mt-2 min-h-5 text-[12.5px]">
        {message}
      </p>
    </>
  );
}
