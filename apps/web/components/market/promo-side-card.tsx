'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PromoCta } from '@/components/market/promo-carousel';
import { getActiveSlots, type PromoAccent, type PromoSlot } from '@/lib/market/promo-slots';
import { cn } from '@/lib/utils';

// Accent -> a left rule colour for the card, drawn from theme tokens. 'cream'
// uses muted-foreground rather than the near-black surface-2 fill so the rule is
// actually visible as a 2px edge in both themes.
const ACCENT_RULE: Record<PromoAccent, string> = {
  pink: 'border-l-primary/70',
  green: 'border-l-accent/70',
  cream: 'border-l-muted-foreground/40',
  default: 'border-l-border',
};

function SideCard({ slot }: { slot: PromoSlot }) {
  const accent = slot.accent ?? 'default';

  return (
    <Card className={cn('border-l-2', ACCENT_RULE[accent])}>
      <CardHeader>
        <CardTitle className="text-sm">{slot.title}</CardTitle>
        <CardDescription>{slot.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <PromoCta slot={slot} />
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
    <aside aria-label="More links" className={cn('grid gap-3', className)}>
      {active.map((slot) => (
        <SideCard key={slot.id} slot={slot} />
      ))}
    </aside>
  );
}
