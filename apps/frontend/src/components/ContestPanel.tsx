import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi';
import type { SubmissionResponse, TaskResponse } from '@taskmarket/shared';
import { IdentityBadge } from './IdentityBadge';
import { API_URL } from '@/lib/api';
import { ArtifactGallery } from './ArtifactGallery';

interface ContestPanelProps {
  task: TaskResponse;
  submissions: SubmissionResponse[];
}

type AcceptStep = 'idle' | 'payment' | 'signing' | 'submitting';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type EthereumWindow = Window &
  typeof globalThis & {
    ethereum?: EthereumProvider;
  };

export function ContestPanel({ task, submissions }: ContestPanelProps) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const [acceptingWorker, setAcceptingWorker] = useState<string | null>(null);
  const [step, setStep] = useState<AcceptStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [textPreviews, setTextPreviews] = useState<Record<string, string>>({});
  const [loadingPreviewsFor, setLoadingPreviewsFor] = useState<string | null>(null);

  const handleAccept = async (workerAddress: string) => {
    if (!address) return;
    setError(null);
    setAcceptingWorker(workerAddress);

    try {
      const url = `${API_URL}/api/tasks/${task.id}/accept`;
      const body = { taskId: task.id, worker: workerAddress };

      // Step 1: probe to get 402 payment requirements
      setStep('payment');
      const probeRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (probeRes.status !== 402) {
        throw new Error(`Expected 402, got ${probeRes.status}`);
      }

      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      if (!accepted) throw new Error('No payment terms in 402 response');

      // Step 2: sign EIP-712 TransferWithAuthorization
      setStep('signing');
      const eip712 = accepted.extra?.eip712;
      const requiredChainId = Number(eip712.domain.chainId);

      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch {
        await (window as EthereumWindow).ethereum?.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
        });
      }

      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as `0x${string}`;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);

      const signature = await signTypedDataAsync({
        domain: {
          name: eip712.domain.name,
          version: eip712.domain.version,
          chainId: Number(eip712.domain.chainId),
          verifyingContract: eip712.domain.verifyingContract as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: eip712.types.TransferWithAuthorization,
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: accepted.payTo as `0x${string}`,
          value: BigInt(accepted.amount),
          validAfter: 0n,
          validBefore,
          nonce,
        },
      });

      // Step 3: retry with payment-signature header
      setStep('submitting');
      const paymentPayload = {
        x402Version: 2,
        scheme: accepted.scheme,
        network: accepted.network,
        payload: {
          signature,
          authorization: {
            from: address,
            to: accepted.payTo,
            value: accepted.amount,
            validAfter: '0',
            validBefore: validBefore.toString(),
            nonce,
          },
        },
        accepted: {
          scheme: accepted.scheme,
          network: accepted.network,
          amount: accepted.amount,
          asset: accepted.asset,
          payTo: accepted.payTo,
          maxTimeoutSeconds: accepted.maxTimeoutSeconds,
        },
      };

      const acceptRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': btoa(JSON.stringify(paymentPayload)),
        },
        body: JSON.stringify(body),
      });

      if (!acceptRes.ok) {
        const err = await acceptRes.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${acceptRes.status}`);
      }

      // Reload page to reflect updated task status
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Acceptance failed');
    } finally {
      setStep('idle');
      setAcceptingWorker(null);
    }
  };

  const acceptLabel = (workerAddress: string) => {
    if (acceptingWorker !== workerAddress) return 'Accept';
    if (step === 'payment') return 'Fetching payment terms...';
    if (step === 'signing') return 'Sign in MetaMask...';
    if (step === 'submitting') return 'Submitting...';
    return 'Accept';
  };

  const handleLoadPreviews = async (submission: SubmissionResponse) => {
    if (!address || !isRequester) return;
    const submissionArtifacts = submission.artifacts ?? [];
    setError(null);
    setLoadingPreviewsFor(submission.id);

    try {
      for (const artifact of submissionArtifacts) {
        if (previewUrls[artifact.id]) continue;

        const signature = await signMessageAsync({
          message: `taskmarket:artifact-preview:${task.id}:${artifact.id}`,
        });
        const res = await fetch(
          `${API_URL}/api/tasks/${task.id}/artifacts/${artifact.id}/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: task.id,
              artifactId: artifact.id,
              viewerAddress: address,
              signature,
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Preview failed: ${res.status}`);
        }

        const body = (await res.json()) as { previewUrl: string };
        setPreviewUrls((current) => ({ ...current, [artifact.id]: body.previewUrl }));

        if (artifact.mediaKind === 'text') {
          const textRes = await fetch(body.previewUrl);
          if (textRes.ok) {
            const text = await textRes.text();
            setTextPreviews((current) => ({ ...current, [artifact.id]: text }));
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoadingPreviewsFor(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Submissions ({submissions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-text-secondary text-center py-10">No submissions yet</p>
          ) : (
            <div className="space-y-4">
              {error && <p className="text-sm text-state-error-primary">{error}</p>}
              {submissions.map((submission) => {
                const submissionArtifacts = submission.artifacts ?? [];
                const canLoadPreviews = isRequester && submissionArtifacts.length > 0;
                const hasMissingPreview = submissionArtifacts.some(
                  (artifact) => !previewUrls[artifact.id]
                );

                return (
                  <div
                    key={submission.id}
                    className="rounded-md border border-border-primary bg-background-primary p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <IdentityBadge
                          agentId={submission.workerAgentId}
                          address={submission.workerAddress}
                        />
                        <p className="text-sm text-text-secondary">
                          Submitted {new Date(submission.submittedAt).toLocaleString()}
                        </p>
                        {submission.workerStats && (
                          <p className="text-xs text-text-tertiary mt-1">
                            {submission.workerStats.completedTasks} tasks,{' '}
                            {submission.workerStats.averageRating?.toFixed(1) || 'N/A'} rating
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canLoadPreviews && hasMissingPreview && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleLoadPreviews(submission)}
                            disabled={loadingPreviewsFor !== null}
                          >
                            {loadingPreviewsFor === submission.id
                              ? 'Loading previews...'
                              : 'Load previews'}
                          </Button>
                        )}
                        {isRequester && task.status === 'pending_approval' && (
                          <Button
                            onClick={() => handleAccept(submission.workerAddress)}
                            disabled={step !== 'idle'}
                            variant="success"
                          >
                            {acceptLabel(submission.workerAddress)}
                          </Button>
                        )}
                      </div>
                    </div>
                    {submissionArtifacts.length > 0 && (
                      <div className="mt-4">
                        <ArtifactGallery
                          artifacts={submissionArtifacts}
                          previewUrls={previewUrls}
                          textPreviews={textPreviews}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
