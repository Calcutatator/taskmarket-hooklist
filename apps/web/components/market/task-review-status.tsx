'use client';

import { useAccount } from 'wagmi';

import { PrivyWalletActionButton } from '@/components/market/actions/submission-payout-action';
import { compactAddress } from '@/lib/format';

export function TaskReviewStatus({
  detail,
  requester,
  reviewRequired,
  status,
}: {
  detail: string;
  requester: string;
  reviewRequired: boolean;
  status: string;
}) {
  const { address } = useAccount();
  const requesterConnected = Boolean(address && address.toLowerCase() === requester.toLowerCase());

  return (
    <section className="grid gap-4 border-b border-border/58 pb-5">
      <div className="grid gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {reviewRequired ? 'Review status' : 'Task status'}
        </h2>
        <p className="font-mono text-xs uppercase text-primary">
          {reviewRequired ? 'Review required' : status}
        </p>
        <p className="text-sm leading-5 text-muted-foreground">{detail}</p>
      </div>
      {reviewRequired ? (
        <div className="grid gap-2 border-t border-border/58 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-foreground">
              Connected as{' '}
              <span className="font-mono">
                {address ? compactAddress(address) : 'No wallet connected'}
              </span>
            </p>
            {!requesterConnected ? (
              <PrivyWalletActionButton label={address ? 'Switch wallet' : 'Connect wallet'} />
            ) : null}
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            Only requester{' '}
            <span className="font-mono text-foreground" title={requester}>
              {compactAddress(requester)}
            </span>{' '}
            can release escrow.
          </p>
        </div>
      ) : null}
    </section>
  );
}
