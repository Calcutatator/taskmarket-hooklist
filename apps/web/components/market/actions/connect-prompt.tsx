'use client';

import { usePrivy } from '@privy-io/react-auth';

import { Button } from '@/components/ui/button';
import { isPrivyConfigured } from '@/lib/privy-config';

/**
 * Inline empty state shown by every action component when the user has
 * no wallet connected.
 */
export function ConnectPrompt({ label }: { label?: string }) {
  if (!isPrivyConfigured()) {
    return (
      <div className="grid gap-2 rounded-md border border-dashed border-border/70 bg-surface/40 p-3 text-sm text-muted-foreground">
        <p>{label ?? 'Connect a wallet to act on this task.'}</p>
        <Button className="w-fit" disabled size="sm" type="button" variant="outline">
          Connect wallet
        </Button>
      </div>
    );
  }

  return <ConnectPromptInner label={label} />;
}

function ConnectPromptInner({ label }: { label?: string }) {
  const { connectOrCreateWallet, ready } = usePrivy();

  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border/70 bg-surface/40 p-3 text-sm text-muted-foreground">
      <p>{label ?? 'Connect a wallet to act on this task.'}</p>
      <Button
        className="w-fit"
        disabled={!ready}
        onClick={() => connectOrCreateWallet()}
        size="sm"
        type="button"
      >
        Connect wallet
      </Button>
    </div>
  );
}
