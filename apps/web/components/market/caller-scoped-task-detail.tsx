'use client';

import type { TaskDetailResponse } from '@taskmarket/shared';
import { useEffect, useState, type ComponentProps } from 'react';
import { useAccount } from 'wagmi';

import { TaskDetailPanel } from '@/components/market/tasks';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getCachedReadAuthAddress, getCachedReadAuthHeaders } from '@/lib/read-auth';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';

type TaskDetailPanelProps = ComponentProps<typeof TaskDetailPanel>;

type CallerProjection = {
  address: string;
  sourceTask: TaskDetailPanelProps['task'];
  task: TaskDetailResponse;
};

/**
 * Keeps the anonymous Server Component projection as the first render, then
 * refreshes only the task record when an existing read-auth proof is available.
 * This never initiates wallet verification: direct task visits remain public,
 * while Inbox navigation reuses the proof collected before the link was shown.
 */
export function CallerScopedTaskDetail(props: TaskDetailPanelProps) {
  const { address, isConnected } = useAccount();
  const readAuth = useReadAuthSignatureState(isConnected ? address : undefined, {
    autoStart: false,
  });
  const [callerProjection, setCallerProjection] = useState<CallerProjection | null>(null);
  const normalizedAddress = address?.toLowerCase();
  const visibleTask =
    readAuth.ready &&
    normalizedAddress &&
    callerProjection?.address === normalizedAddress &&
    callerProjection.sourceTask === props.task
      ? callerProjection.task
      : props.task;

  useEffect(() => {
    if (!isConnected || !address || !readAuth.ready) return;

    const requestedAddress = address.toLowerCase();
    if (getCachedReadAuthAddress() !== requestedAddress) return;

    const controller = new AbortController();
    let active = true;
    const sourceTask = props.task;

    async function hydrateCallerProjection() {
      try {
        const response = await fetch(
          `${getBrowserApiBaseUrl()}/api/tasks/${encodeURIComponent(sourceTask.id)}`,
          {
            headers: { accept: 'application/json', ...getCachedReadAuthHeaders() },
            signal: controller.signal,
          }
        );
        if (!response.ok) return;

        const task = (await response.json()) as TaskDetailResponse | null;
        if (!active || !task) return;
        setCallerProjection({ address: requestedAddress, sourceTask, task });
      } catch {
        // Caller enrichment is optional. The anonymous SSR task remains usable.
      }
    }

    void hydrateCallerProjection();
    return () => {
      active = false;
      controller.abort();
    };
  }, [address, isConnected, props.task, readAuth.ready]);

  return <TaskDetailPanel {...props} task={visibleTask} />;
}
