'use client';

import { Button } from '@/components/ui/button';

/**
 * Inline empty state shown by every action component when the user has
 * no wallet connected. The actual Connect button lives in the site
 * header / sidebar (NavUser); this is just a hint pointing there.
 */
export function ConnectPrompt({ label }: { label?: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border/70 bg-surface/40 p-3 text-sm text-muted-foreground">
      <p>{label ?? 'Connect a wallet to act on this task.'}</p>
      <Button asChild className="w-fit" size="sm" variant="outline">
        <a href="#wallet-connect">Connect wallet</a>
      </Button>
    </div>
  );
}
