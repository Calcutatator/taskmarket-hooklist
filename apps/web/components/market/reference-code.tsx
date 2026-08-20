// Implements: ADR-0098

import { CopyButton } from '@/components/market/copy-button';

/**
 * A task's or submission's public name, with a copy control.
 *
 * Monospace because the value is meant to be transcribed: a reader comparing a code on screen
 * against one in a message needs the characters to line up. The code is deliberately the only
 * identifier shown -- displaying it alongside the primary key would leave a reader guessing which
 * one to quote, which is worse than showing neither.
 *
 * A server component: it renders text and delegates the one interactive part to `CopyButton`,
 * which is the smallest leaf that genuinely needs the browser.
 */
export function ReferenceCode({
  className,
  code,
  label = 'Reference code',
}: {
  className?: string;
  code: string | null | undefined;
  label?: string;
}) {
  // Rows created before the backfill have no code yet (migration 0051 leaves the column nullable
  // until it completes), so this renders nothing rather than an empty affordance.
  if (!code) return null;

  return (
    <span className={className}>
      <span className="inline-flex items-center gap-1 rounded-md border border-border/58 bg-muted/26 py-0.5 pl-2 pr-0.5 font-mono text-xs text-muted-foreground">
        <span title={label}>{code}</span>
        <CopyButton label={`Copy ${label.toLowerCase()} ${code}`} text={code} />
      </span>
    </span>
  );
}
