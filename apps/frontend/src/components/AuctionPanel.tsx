import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { API_URL } from '@/lib/api';

type ActionStep = 'idle' | 'payment' | 'signing' | 'submitting';

interface AuctionPanelProps {
  task: TaskResponse;
}

function ClockPriceDisplay({
  task,
  onAccept,
  acceptStep,
}: {
  task: TaskResponse;
  onAccept?: () => void;
  acceptStep: ActionStep;
}) {
  if (task.auctionType !== 'dutch' && task.auctionType !== 'reverse_dutch') return null;
  if (!task.currentAuctionPrice) return null;

  const isDutch = task.auctionType === 'dutch';
  const scheduleTs = isDutch ? task.auctionPriceReachesFloorAt : task.auctionPriceReachesMaxAt;
  const scheduleLabel = isDutch ? 'Reaches floor at' : 'Reaches max at';

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">
            {isDutch
              ? 'Descending clock — first to accept wins'
              : 'Ascending clock — first to accept wins'}
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Current price</p>
            <p className="text-2xl font-bold text-state-success-primary">
              {formatUSDC(task.currentAuctionPrice)} USDC
            </p>
          </div>
          {scheduleTs && (
            <p className="text-xs text-text-tertiary">
              {scheduleLabel}: {new Date(scheduleTs).toLocaleString()}
            </p>
          )}
          {task.bidDeadline && (
            <p className="text-xs text-text-tertiary">
              Clock expires: {new Date(task.bidDeadline).toLocaleString()}
            </p>
          )}
          {onAccept ? (
            <Button className="w-full mt-2" onClick={onAccept} disabled={acceptStep !== 'idle'}>
              {acceptStep === 'idle'
                ? `Accept at ${formatUSDC(task.currentAuctionPrice)} USDC`
                : acceptStep === 'payment'
                  ? 'Fetching payment terms...'
                  : acceptStep === 'signing'
                    ? 'Sign in wallet...'
                    : 'Submitting...'}
            </Button>
          ) : (
            <p className="text-xs text-text-secondary mt-1">
              Run: <code>taskmarket task auction-accept {task.id}</code>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AuctionPanel({ task }: AuctionPanelProps) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { data: bids } = trpc.bids.listByTask.useQuery({ taskId: task.id });

  const [acceptStep, setAcceptStep] = useState<ActionStep>('idle');
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [winnerStep, setWinnerStep] = useState<'idle' | 'submitting'>('idle');
  const [winnerError, setWinnerError] = useState<string | null>(null);

  const now = new Date();
  const deadlinePassed = task.bidDeadline ? now >= new Date(task.bidDeadline) : false;
  const isSealed =
    task.auctionType === 'reverse_english' && task.status === 'open' && !deadlinePassed;
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const isWorker = !!address && !isRequester;

  const showAcceptButton =
    isWorker &&
    task.status === 'open' &&
    !deadlinePassed &&
    (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') &&
    task.currentAuctionPrice != null;

  const showSelectWinnerButton =
    isRequester &&
    task.status === 'open' &&
    deadlinePassed &&
    (task.auctionBidCount ?? 0) > 0 &&
    (task.auctionType === 'english' || task.auctionType === 'reverse_english');

  const handleAuctionAccept = async () => {
    if (!address) return;
    setAcceptError(null);
    try {
      setAcceptStep('payment');
      const url = `${API_URL}/api/tasks/${task.id}/bids/accept`;
      const body = { taskId: task.id };
      const probeRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (probeRes.status !== 402) throw new Error(`Expected 402, got ${probeRes.status}`);
      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      if (!accepted) throw new Error('No payment terms in 402 response');

      setAcceptStep('signing');
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

      setAcceptStep('submitting');
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
      setAcceptError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setAcceptStep('idle');
    }
  };

  const handleSelectWinner = async () => {
    if (!address) return;
    setWinnerError(null);
    setWinnerStep('submitting');
    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.id}/bids/select-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          ((err as Record<string, unknown>).error as string) || `Server error: ${res.status}`
        );
      }
      window.location.reload();
    } catch (err) {
      setWinnerError(err instanceof Error ? err.message : 'Select winner failed');
    } finally {
      setWinnerStep('idle');
    }
  };

  const subtypeLabel: Record<string, string> = {
    dutch: 'Dutch (Descending Clock)',
    english: 'English (Open Bids)',
    reverse_dutch: 'Reverse Dutch (Ascending Clock)',
    reverse_english: 'Reverse English (Sealed Bids)',
  };

  return (
    <div className="space-y-4">
      {task.auctionType && (
        <p className="text-sm text-text-secondary">
          Subtype:{' '}
          <span className="font-medium">{subtypeLabel[task.auctionType] ?? task.auctionType}</span>
        </p>
      )}

      <ClockPriceDisplay
        task={task}
        onAccept={showAcceptButton ? handleAuctionAccept : undefined}
        acceptStep={acceptStep}
      />
      {acceptError && <p className="text-sm text-state-error-primary">{acceptError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>
            Bids (
            {task.auctionBidCount !== null && task.auctionBidCount !== undefined
              ? task.auctionBidCount
              : (bids?.length ?? 0)}
            )
            {isSealed && (
              <span className="ml-2 text-sm font-normal text-text-secondary">
                — sealed until deadline
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {task.auctionType === 'english' && task.currentLowestBid && (
            <p className="text-sm mb-3">
              Current lowest:{' '}
              <span className="font-bold text-state-success-primary">
                {formatUSDC(task.currentLowestBid)} USDC
              </span>
            </p>
          )}
          {isSealed ? (
            <p className="text-text-secondary text-center py-8">
              {task.auctionBidCount ?? 0} sealed bid(s) — prices hidden until deadline
            </p>
          ) : !bids || bids.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No bids yet</p>
          ) : (
            <div className="space-y-3">
              {bids.map((bid, index) => (
                <Card key={bid.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {index === 0 && (
                            <span className="text-xs font-semibold text-state-success-primary">
                              Lowest
                            </span>
                          )}
                          {bid.workerAddress ? (
                            <IdentityBadge
                              agentId={bid.workerAgentId ?? null}
                              address={bid.workerAddress}
                            />
                          ) : (
                            <span className="text-xs text-text-tertiary">Hidden</span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary">
                          {new Date(bid.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-xl font-bold text-state-success-primary">
                        {bid.price ? `${formatUSDC(bid.price)} USDC` : '—'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(showSelectWinnerButton || winnerError) && (
        <div className="space-y-2">
          {showSelectWinnerButton && (
            <>
              {winnerError && <p className="text-sm text-state-error-primary">{winnerError}</p>}
              <Button
                className="w-full"
                onClick={() => void handleSelectWinner()}
                disabled={winnerStep !== 'idle'}
              >
                {winnerStep === 'idle' ? 'Select Winner' : 'Selecting...'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
