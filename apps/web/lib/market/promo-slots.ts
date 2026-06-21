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
    title: 'Task Drops',
    body: 'Get a heads-up when fresh batches of tasks open up, before they fill.',
    href: '#',
    ctaLabel: 'Sign up for drops',
    active: true,
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
    ctaLabel: 'Get notified',
    active: true,
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
    title: 'Never miss a drop',
    body: 'Join the Task Drops list and get notified the moment new batches go live.',
    href: '#',
    ctaLabel: 'Join the list',
    active: true,
    accent: 'default',
  },
] as const satisfies readonly PromoSlot[];

// Filter a slot array down to the entries that should render. Pure helper so the
// presentational components never reason about the active flag themselves.
export function getActiveSlots<T extends PromoSlot>(slots: readonly T[]): T[] {
  return slots.filter((slot) => slot.active);
}
