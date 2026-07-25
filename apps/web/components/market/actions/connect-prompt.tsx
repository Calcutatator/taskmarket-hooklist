'use client';

import { PrivyWalletAccessButton } from '@/components/privy-account-control';

/**
 * Inline empty state shown by every action component when the user has
 * no wallet connected.
 */
export function ConnectPrompt({ label }: { label?: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border/70 bg-surface/40 p-3 text-sm text-muted-foreground">
      <p>{label ?? 'Sign in to act on this task.'}</p>
      <p className="text-xs leading-5">
        Use email, Google, or an existing wallet. Taskmarket can create a wallet for new users.
      </p>
      <PrivyWalletAccessButton className="min-h-11 w-fit" />
    </div>
  );
}
