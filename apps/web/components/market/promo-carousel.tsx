'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { getActiveSlots, type PromoAccent, type PromoSlot } from '@/lib/market/promo-slots';
import { cn } from '@/lib/utils';

// Accent -> a top rule colour for the card, drawn from theme tokens.
const ACCENT_RULE: Record<PromoAccent, string> = {
  pink: 'border-t-primary/70',
  green: 'border-t-accent/70',
  cream: 'border-t-surface-2',
  default: 'border-t-border',
};

function isInternal(href: string): boolean {
  return href.startsWith('/');
}

function CarouselCard({ slot }: { slot: PromoSlot }) {
  const accent = slot.accent ?? 'default';

  return (
    <Card className={cn('w-64 shrink-0 snap-start gap-3 border-t-2 py-4', ACCENT_RULE[accent])}>
      <CardContent className="grid gap-3">
        <div className="grid gap-1">
          <CardTitle className="text-sm">{slot.title}</CardTitle>
          <CardDescription>{slot.body}</CardDescription>
        </div>
        {isInternal(slot.href) ? (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <Link href={slot.href as Route}>{slot.ctaLabel}</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a href={slot.href} target="_blank" rel="noreferrer">
              {slot.ctaLabel}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// A horizontally scrolling row of cross-promo cards. Scroll-snaps on touch and
// renders only active slots; returns null when nothing is active.
export function PromoCarousel({
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
    <div
      aria-label="Cross-promotion"
      role="region"
      className={cn(
        'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:thin]',
        className
      )}
    >
      {active.map((slot) => (
        <CarouselCard key={slot.id} slot={slot} />
      ))}
    </div>
  );
}
