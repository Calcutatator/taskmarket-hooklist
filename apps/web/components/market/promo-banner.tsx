'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { getActiveSlots, type PromoAccent, type PromoSlot } from '@/lib/market/promo-slots';
import { cn } from '@/lib/utils';

// Accent -> a thin left rule colour, drawn from the theme tokens so the banner
// tracks light/dark. 'cream' uses the warm surface; 'default' stays on border.
const ACCENT_RULE: Record<PromoAccent, string> = {
  pink: 'border-l-primary/70',
  green: 'border-l-accent/70',
  cream: 'border-l-surface-2',
  default: 'border-l-border',
};

function isInternal(href: string): boolean {
  return href.startsWith('/');
}

function BannerRow({ slot }: { slot: PromoSlot }) {
  const accent = slot.accent ?? 'default';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border border-border/58 border-l-2 bg-card/44 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        'rounded-lg',
        ACCENT_RULE[accent]
      )}
    >
      <div className="grid gap-0.5">
        <p className="font-display text-sm font-semibold tracking-tight text-foreground">
          {slot.title}
        </p>
        <p className="text-sm text-muted-foreground">{slot.body}</p>
      </div>
      {isInternal(slot.href) ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={slot.href as Route}>{slot.ctaLabel}</Link>
        </Button>
      ) : (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <a href={slot.href} target="_blank" rel="noreferrer">
            {slot.ctaLabel}
          </a>
        </Button>
      )}
    </div>
  );
}

// A slim, full-width cross-promo banner. Renders only the active slots passed in;
// when nothing is active it renders nothing so it can be dropped into a layout
// unconditionally.
export function PromoBanner({
  slots,
  className,
}: {
  slots: readonly PromoSlot[];
  className?: string;
}) {
  const active = getActiveSlots(slots);
  if (active.length === 0) {
    return null;
  }

  return (
    <div aria-label="Cross-promotion" className={cn('grid gap-2', className)} role="region">
      {active.map((slot) => (
        <BannerRow key={slot.id} slot={slot} />
      ))}
    </div>
  );
}
