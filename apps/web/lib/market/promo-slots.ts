// Config-driven cross-promo inventory. Each slot is a single, honest message that
// points somewhere useful in the wider product surface. These follow the typed
// constants pattern used by task-templates.ts and task-mode-config.ts.
//
// IMPORTANT: these entries are edited HERE, in source, and shipped with a build.
// This is NOT runtime configuration -- changing copy, links, or the active flag
// requires a redeploy. Keep the copy on-brand: no price or tokenomics claims, no
// emojis, one clear idea per slot. Swap the placeholder hrefs ('#' and docs URLs)
// for real destinations as those surfaces ship.

// Visual accent for a promo block. Maps onto existing theme tokens in the
// presentational components (primary rose, sage accent, warm cream surface);
// 'default' leaves the neutral card treatment in place.
export type PromoAccent = 'pink' | 'green' | 'cream' | 'default';

export type PromoSlot = {
  // Stable identifier, also used as the React key.
  id: string;
  // Short headline -- the one idea the block communicates.
  title: string;
  // One or two supporting sentences. Keep it scannable.
  body: string;
  // Destination. Internal routes start with '/'; external links are full URLs.
  // Placeholder '#' marks a surface that is not live yet.
  href: string;
  // Call-to-action label rendered on the button or link.
  ctaLabel: string;
  // When false the slot is hidden everywhere via getActiveSlots.
  active: boolean;
  // Optional accent; omit for the neutral 'default' treatment.
  accent?: PromoAccent;
};

// Slim full-width banner inventory. Use for a single priority message at the top
// or bottom of a page.
export const BANNER_SLOTS = [
  {
    id: 'guided-consumer',
    title: 'Try the guided way to post a task',
    body: 'A step-by-step experience that turns a plain request into a ready-to-run brief. Coming soon.',
    href: '#',
    ctaLabel: 'Join the early list',
    active: true,
    accent: 'pink',
  },
] as const satisfies readonly PromoSlot[];

// Horizontal carousel inventory. Use for a scrollable row of related entry
// points the visitor can browse.
export const CAROUSEL_SLOTS = [
  {
    id: 'task-drops',
    title: 'Follow specific drops',
    body: 'Drop subscriptions now live on individual drop pages.',
    href: '#',
    ctaLabel: 'Open a drop',
    active: false,
    accent: 'green',
  },
  {
    id: 'dreams-discover',
    title: 'Discover Dreams',
    body: 'Browse the incentives running across Dreams and find work that fits.',
    href: 'https://docs.taskmarket.xyz',
    ctaLabel: 'Explore Dreams',
    active: true,
    accent: 'cream',
  },
  {
    id: 'guided-consumer-card',
    title: 'Guided task posting',
    body: 'Describe what you need in plain words and let the guided flow shape the brief.',
    href: '#',
    // Hidden: the top PromoBanner already carries the guided-posting pitch, so
    // repeating it at the bottom of the same page reads as filler. Re-enable
    // only if it points somewhere the banner does not.
    ctaLabel: 'Get notified',
    active: false,
    accent: 'pink',
  },
] as const satisfies readonly PromoSlot[];

// Stacked side-card inventory. Use in a sidebar or rail for supporting links
// that do not compete with the primary content.
export const SIDE_CARD_SLOTS = [
  {
    id: 'dreams-incentives',
    title: 'Dreams incentives',
    body: 'See the active incentives and follow the ones that match your work.',
    href: 'https://docs.taskmarket.xyz',
    ctaLabel: 'View incentives',
    active: true,
    accent: 'green',
  },
  {
    id: 'task-drops-side',
    title: 'Follow specific drops',
    body: 'Subscribe from an individual drop page to get scoped new-task email.',
    href: '#',
    // Hidden: duplicates the 'task-drops' carousel card in the same viewport.
    // Keep Task Drops in one place until this slot points somewhere distinct.
    ctaLabel: 'Join the list',
    active: false,
    accent: 'default',
  },
] as const satisfies readonly PromoSlot[];

// Filter a slot array down to the entries that should render. Pure helper so the
// presentational components never reason about the active flag themselves.
export function getActiveSlots<T extends PromoSlot>(slots: readonly T[]): T[] {
  return slots.filter((slot) => slot.active);
}
