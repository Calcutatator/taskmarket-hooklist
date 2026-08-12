'use client';

import { useAccount } from 'wagmi';

import { PrivyWalletActionButton } from '@/components/market/actions/submission-payout-action';
import { Button } from '@/components/ui/button';
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
    <section className="grid gap-5">
      <div className="grid gap-2.5">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {reviewRequired ? 'Next action' : 'Task status'}
        </h2>
        <p className="text-base font-semibold text-primary">
          {reviewRequired ? 'Review submissions' : status}
        </p>
        <p className="text-base leading-6 text-muted-foreground">{detail}</p>
      </div>
      {reviewRequired ? (
        <div className="grid gap-3 border-t border-border/58 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {address ? (
                <>
                  Connected as{' '}
                  <span className="font-mono text-foreground">{compactAddress(address)}</span>
                </>
              ) : (
                'Requester access required'
              )}
            </p>
            {requesterConnected ? (
              <Button asChild className="min-h-11">
                <a href="#task-activity">Review submissions</a>
              </Button>
            ) : (
              <PrivyWalletActionButton label={address ? 'Switch wallet' : 'Sign in to review'} />
            )}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Requester{' '}
            <span className="font-mono text-foreground" title={requester}>
              {compactAddress(requester)}
            </span>{' '}
            can accept work and release payment.
          </p>
        </div>
      ) : null}
    </section>
  );
}
