'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEADLINE_SETTLE_BUFFER_MS = 250;

export function DropLifecycleRefresh({ refreshAt }: Readonly<{ refreshAt: string | null }>) {
  const router = useRouter();

  useEffect(() => {
    if (!refreshAt) {
      return;
    }
    const target = new Date(refreshAt).getTime();
    if (!Number.isFinite(target)) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    function schedule() {
      const remaining = target + DEADLINE_SETTLE_BUFFER_MS - Date.now();
      if (remaining <= 0) {
        router.refresh();
        return;
      }
      timeout = setTimeout(schedule, Math.min(remaining, MAX_TIMEOUT_MS));
    }

    schedule();
    return () => {
      clearTimeout(timeout);
    };
  }, [refreshAt, router]);

  return null;
}
