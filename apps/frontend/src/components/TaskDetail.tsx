import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { CopyCommand } from './ui/copy-button';
import type { TaskDetailResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { IdentityBadge } from './IdentityBadge';
import { getStatusVariant } from '@/lib/status';
import { API_URL } from '@/lib/api';

interface TaskDetailProps {
  task: TaskDetailResponse;
}

type ActionStep = 'idle' | 'payment' | 'signing' | 'submitting';

export function TaskDetail({ task }: TaskDetailProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const isRequester = isConnected && address?.toLowerCase() === task.requester.toLowerCase();
  const visibleActions = isConnected
    ? task.pendingActions.filter((a) =>
        isRequester ? a.role === 'requester' : a.role === 'worker'
      )
    : task.pendingActions;
  const modeVariant = task.mode as 'bounty' | 'claim' | 'pitch' | 'benchmark' | 'auction';
  const expiryDate = new Date(task.expiryTime);
  const createdDate = new Date(task.createdAt);

  const [cancelStep, setCancelStep] = useState<ActionStep>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [updateStep, setUpdateStep] = useState<ActionStep>('idle');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const initialReward = formatUSDC(task.reward);
  const [newReward, setNewReward] = useState(initialReward);
  const [extendHours, setExtendHours] = useState('');

  const rewardChanged = newReward.trim() !== '' && newReward !== initialReward;
  const expiryChanged = extendHours.trim() !== '' && Number(extendHours) > 0;
  const canUpdate = rewardChanged || expiryChanged;

  const hasCancelAction = isRequester && visibleActions.some((a) => a.action === 'cancel');
  const hasUpdateAction = isRequester && visibleActions.some((a) => a.action === 'update');
  const copyActions = visibleActions.filter(
    (a) => !(isRequester && (a.action === 'cancel' || a.action === 'update'))
  );

  const runX402 = async (
    url: string,
    body: Record<string, unknown>,
    setStep: (s: ActionStep) => void,
    setError: (e: string | null) => void
  ) => {
    if (!address) return;
    setError(null);
    try {
      setStep('payment');
      const probeRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (probeRes.status !== 402) throw new Error(`Expected 402, got ${probeRes.status}`);
      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      if (!accepted) throw new Error('No payment terms in 402 response');

      setStep('signing');
      const eip712 = accepted.extra?.eip712;
      if (!eip712?.domain) throw new Error('Missing EIP-712 payment data');
      const requiredChainId = Number(eip712.domain.chainId);
      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).ethereum?.request({
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
        types: { TransferWithAuthorization: eip712.types.TransferWithAuthorization },
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
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': btoa(JSON.stringify(paymentPayload)),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          ((err as Record<string, unknown>).error as string) || `Server error: ${res.status}`
        );
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setStep('idle');
    }
  };

  const handleCancel = () => {
    void runX402(
      `${API_URL}/api/tasks/${task.id}/cancel`,
      { taskId: task.id },
      setCancelStep,
      setCancelError
    );
  };

  const handleUpdate = () => {
    const body: Record<string, unknown> = { taskId: task.id };
    if (rewardChanged) {
      const rewardNum = Number(newReward);
      if (!isFinite(rewardNum) || rewardNum < 0) {
        setUpdateError('Invalid reward amount');
        return;
      }
      body.reward = String(Math.round(rewardNum * 1_000_000));
    }
    if (expiryChanged) {
      const currentExpiryUnix = Math.floor(new Date(task.expiryTime).getTime() / 1000);
      body.expiryTime = currentExpiryUnix + Math.round(Number(extendHours) * 3600);
    }
    void runX402(`${API_URL}/api/tasks/${task.id}/update`, body, setUpdateStep, setUpdateError);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={modeVariant}>{task.mode}</Badge>
          <Badge variant={getStatusVariant(task.status)}>{task.status.replace(/_/g, ' ')}</Badge>
        </div>
        <CardTitle className="text-2xl">Task Details</CardTitle>
        <CardDescription>
          Created by <IdentityBadge agentId={task.requesterAgentId} address={task.requester} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-heading font-semibold mb-2">Description</h3>
          <p className="text-text-secondary whitespace-pre-wrap">{task.description}</p>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">
              {task.mode === 'auction' ? 'Max Price' : 'Reward'}
            </h3>
            <p className="text-2xl font-bold text-state-success-primary">
              {formatUSDC(task.mode === 'auction' && task.maxPrice ? task.maxPrice : task.reward)}{' '}
              USDC
            </p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Platform Fee</h3>
            <p className="text-lg">{(task.platformFeeBps / 100).toFixed(1)}%</p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Created</h3>
            <p className="text-sm text-text-secondary">{createdDate.toLocaleString()}</p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Expires</h3>
            <p className="text-sm text-text-secondary">{expiryDate.toLocaleString()}</p>
          </div>
        </div>

        {task.mode === 'claim' && task.stakeRequired && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Stake Required</h3>
              <p className="text-sm text-text-secondary">
                {(task.stakeBps / 100).toFixed(1)}% of reward
              </p>
            </div>
          </>
        )}

        {task.mode === 'pitch' && task.pitchDeadline && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Pitch Deadline</h3>
              <p className="text-sm text-text-secondary">
                {new Date(task.pitchDeadline).toLocaleString()}
              </p>
            </div>
          </>
        )}

        {task.mode === 'benchmark' && task.metricDescription && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Metric</h3>
              <p className="text-sm text-text-secondary">{task.metricDescription}</p>
              <p className="text-sm font-semibold mt-1">Target: {task.metricTarget}</p>
            </div>
          </>
        )}

        {task.mode === 'auction' && (
          <>
            <Separator />
            <div className="space-y-2">
              {task.maxPrice && (
                <div>
                  <h3 className="font-heading font-semibold text-sm mb-1">Max Price</h3>
                  <p className="text-sm text-text-secondary">{formatUSDC(task.maxPrice)} USDC</p>
                </div>
              )}
              {task.bidDeadline && (
                <div>
                  <h3 className="font-heading font-semibold text-sm mb-1">Bid Deadline</h3>
                  <p className="text-sm text-text-secondary">
                    {new Date(task.bidDeadline).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {task.tags.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {hasCancelAction && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-2">Cancel task</h3>
              {cancelError && (
                <p className="text-sm text-state-error-primary mb-2">{cancelError}</p>
              )}
              <Button variant="destructive" onClick={handleCancel} disabled={cancelStep !== 'idle'}>
                {cancelStep === 'idle'
                  ? 'Cancel Task'
                  : cancelStep === 'payment'
                    ? 'Fetching payment terms...'
                    : cancelStep === 'signing'
                      ? 'Sign in wallet...'
                      : 'Cancelling...'}
              </Button>
            </div>
          </>
        )}

        {hasUpdateAction && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="font-heading font-semibold text-sm">Update task</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">
                    New reward (USDC)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newReward}
                    onChange={(e) => setNewReward(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">
                    Extend expiry (hours)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={extendHours}
                    onChange={(e) => setExtendHours(e.target.value)}
                  />
                </div>
              </div>
              {updateError && <p className="text-sm text-state-error-primary">{updateError}</p>}
              <Button onClick={handleUpdate} disabled={!canUpdate || updateStep !== 'idle'}>
                {updateStep === 'idle'
                  ? 'Update Task'
                  : updateStep === 'payment'
                    ? 'Fetching payment terms...'
                    : updateStep === 'signing'
                      ? 'Sign in wallet...'
                      : 'Updating...'}
              </Button>
            </div>
          </>
        )}

        {copyActions.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-2">Available actions</h3>
              <div className="space-y-2">
                {copyActions.map((a, i) => (
                  <CopyCommand
                    key={i}
                    command={a.command}
                    role={!isConnected ? a.role : undefined}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
