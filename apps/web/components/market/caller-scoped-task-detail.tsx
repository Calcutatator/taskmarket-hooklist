'use client';

import type { SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';
import { useEffect, useState, type ComponentProps } from 'react';
import { useAccount } from 'wagmi';

import { TaskDetailPanel, type TaskModeData } from '@/components/market/tasks';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getCachedReadAuthAddress, getCachedReadAuthHeaders } from '@/lib/read-auth';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';

type TaskDetailPanelProps = ComponentProps<typeof TaskDetailPanel>;

type CallerProjection = {
  address: string;
  modeData: TaskModeData | undefined;
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
  const visibleModeData =
    readAuth.ready &&
    callerProjection !== null &&
    callerProjection.address === normalizedAddress &&
    callerProjection.sourceTask === props.task
      ? callerProjection.modeData
      : props.modeData;

  useEffect(() => {
    if (!isConnected || !address || !readAuth.ready) return;

    const requestedAddress = address.toLowerCase();
    if (getCachedReadAuthAddress() !== requestedAddress) return;

    const controller = new AbortController();
    let active = true;
    const sourceTask = props.task;

    async function hydrateCallerProjection() {
      try {
        const headers = { accept: 'application/json', ...getCachedReadAuthHeaders() };
        const response = await fetch(
          `${getBrowserApiBaseUrl()}/api/tasks/${encodeURIComponent(sourceTask.id)}`,
          {
            headers,
            signal: controller.signal,
          }
        );
        if (!response.ok) return;

        const task = (await response.json()) as TaskDetailResponse | null;
        if (!active || !task) return;

        let modeData = props.modeData;
        const needsDecisionEvidence = task.pendingActions?.some(
          (action) => action.action === 'evaluate' || action.action === 'resolve_dispute'
        );
        if (needsDecisionEvidence) {
          const evidenceResponse = await fetch(
            `${getBrowserApiBaseUrl()}/api/tasks/${encodeURIComponent(
              sourceTask.id
            )}/submissions?includePreviewUrls=media`,
            { headers, signal: controller.signal }
          );
          if (evidenceResponse.ok) {
            const submissions = (await evidenceResponse.json()) as SubmissionResponse[];
            if (Array.isArray(submissions)) {
              modeData = { ...modeData, submissions };
            }
          }
        }

        if (!active) return;
        setCallerProjection({ address: requestedAddress, modeData, sourceTask, task });
      } catch {
        // Caller enrichment is optional. The anonymous SSR task remains usable.
      }
    }

    void hydrateCallerProjection();
    return () => {
      active = false;
      controller.abort();
    };
  }, [address, isConnected, props.modeData, props.task, readAuth.ready]);

  return <TaskDetailPanel {...props} modeData={visibleModeData} task={visibleTask} />;
}
