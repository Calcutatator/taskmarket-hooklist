'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveSlots, type PromoAccent, type PromoSlot } from '@/lib/market/promo-slots';
import { cn } from '@/lib/utils';

// Accent -> a top rule colour for the card, drawn from theme tokens. 'cream'
// uses muted-foreground rather than the near-black surface-2 fill so the rule is
// actually visible as a 2px edge in both themes.
const ACCENT_RULE: Record<PromoAccent, string> = {
  pink: 'border-t-primary/70',
  green: 'border-t-accent/70',
  cream: 'border-t-muted-foreground/40',
  default: 'border-t-border',
};

function isInternal(href: string): boolean {
  return href.startsWith('/');
}

// The slot CTA. A '#' href marks a destination that has not shipped yet; render
// it as a disabled control rather than a live `<a href="#" target="_blank">`,
// which would open a junk tab to the same page.
export function PromoCta({ slot }: { slot: PromoSlot }) {
  if (slot.href === '#') {
    return (
      <Button className="w-fit" disabled size="sm" variant="outline">
        Coming soon
      </Button>
    );
  }

  if (isInternal(slot.href)) {
    return (
      <Button asChild className="w-fit" size="sm" variant="outline">
        <Link href={slot.href as Route}>{slot.ctaLabel}</Link>
      </Button>
    );
  }

  return (
    <Button asChild className="w-fit" size="sm" variant="outline">
      <a href={slot.href} rel="noreferrer" target="_blank">
        {slot.ctaLabel}
      </a>
    </Button>
  );
}

function CarouselCard({ slot }: { slot: PromoSlot }) {
  const accent = slot.accent ?? 'default';

  return (
    <Card
      className={cn(
        'h-full w-64 shrink-0 snap-start border-t-2 @4xl/main:w-auto @4xl/main:flex-1',
        ACCENT_RULE[accent]
      )}
    >
      <CardHeader>
        <CardTitle className="text-sm">{slot.title}</CardTitle>
        <CardDescription>{slot.body}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <PromoCta slot={slot} />
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
      aria-label="Featured on Taskmarket"
      role="region"
      tabIndex={0}
      className={cn(
        'flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-lg pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background [-ms-overflow-style:none] [scrollbar-width:thin] @4xl/main:snap-none @4xl/main:overflow-visible @4xl/main:pb-0',
        className
      )}
    >
      {active.map((slot) => (
        <CarouselCard key={slot.id} slot={slot} />
      ))}
    </div>
  );
}
