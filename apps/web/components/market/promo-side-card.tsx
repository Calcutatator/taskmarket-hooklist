'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { getActiveSlots, type PromoAccent, type PromoSlot } from '@/lib/market/promo-slots';
import { cn } from '@/lib/utils';

// Accent -> a left rule colour for the card, drawn from theme tokens.
const ACCENT_RULE: Record<PromoAccent, string> = {
  pink: 'border-l-primary/70',
  green: 'border-l-accent/70',
  cream: 'border-l-surface-2',
  default: 'border-l-border',
};

function isInternal(href: string): boolean {
  return href.startsWith('/');
}

function SideCard({ slot }: { slot: PromoSlot }) {
  const accent = slot.accent ?? 'default';

  return (
    <Card className={cn('gap-3 border-l-2 py-4', ACCENT_RULE[accent])}>
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

// A stacked column of cross-promo cards for a sidebar or rail. Renders only the
// active slots and returns null when nothing is active.
export function PromoSideCard({
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
    <aside aria-label="Cross-promotion" className={cn('grid gap-3', className)}>
      {active.map((slot) => (
        <SideCard key={slot.id} slot={slot} />
      ))}
    </aside>
  );
}
