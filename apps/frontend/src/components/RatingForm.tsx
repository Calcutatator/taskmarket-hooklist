import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import type { TaskResponse } from '@taskmarket/shared';
import { API_URL } from '@/lib/api';

interface RatingFormProps {
  task: TaskResponse;
}

type RateStep = 'idle' | 'payment' | 'signing' | 'submitting';

export function RatingForm({ task }: RatingFormProps) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [step, setStep] = useState<RateStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const canRate = task.status === 'accepted' && task.rating === 0 && isRequester;

  if (!canRate) return null;

  const handleRate = async () => {
    if (!address || selectedRating === 0) return;
    setError(null);

    try {
      const url = `${API_URL}/api/tasks/${task.id}/rate`;
      const body = {
        taskId: task.id,
        worker: task.worker,
        rating: selectedRating * 20, // convert 1-5 stars to 0-100 scale
      };

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

      const rateRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': btoa(JSON.stringify(paymentPayload)),
        },
        body: JSON.stringify(body),
      });

      if (!rateRes.ok) {
        const err = await rateRes.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${rateRes.status}`);
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rating failed');
    } finally {
      setStep('idle');
    }
  };

  const isPending = step !== 'idle';

  const buttonLabel = () => {
    if (step === 'payment') return 'Fetching payment terms...';
    if (step === 'signing') return 'Sign in MetaMask...';
    if (step === 'submitting') return 'Submitting Rating...';
    return 'Submit Rating';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate This Task</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-text-secondary">How would you rate the quality of work delivered?</p>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === selectedRating}
              aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
              className={`text-4xl transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 rounded ${
                star <= (hoverRating || selectedRating)
                  ? 'text-state-warning-primary'
                  : 'text-border-primary'
              }`}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onFocus={() => setHoverRating(star)}
              onBlur={() => setHoverRating(0)}
              onClick={() => setSelectedRating(star)}
            >
              ★
            </button>
          ))}
          <span className="ml-2 text-text-secondary">
            {selectedRating > 0
              ? `${selectedRating} star${selectedRating > 1 ? 's' : ''}`
              : 'Select rating'}
          </span>
        </div>
        {error && <p className="text-sm text-state-error-primary">{error}</p>}
        <Button
          onClick={handleRate}
          disabled={selectedRating === 0 || isPending}
          variant="success"
          className="w-full"
        >
          {buttonLabel()}
        </Button>
      </CardContent>
    </Card>
  );
}
