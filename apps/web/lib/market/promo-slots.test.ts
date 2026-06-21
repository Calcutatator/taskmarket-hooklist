import { describe, expect, it } from 'vitest';
import {
  BANNER_SLOTS,
  CAROUSEL_SLOTS,
  SIDE_CARD_SLOTS,
  getActiveSlots,
  type PromoSlot,
} from './promo-slots';

function slot(overrides: Partial<PromoSlot> = {}): PromoSlot {
  return {
    id: 'test',
    title: 'Title',
    body: 'Body',
    href: '#',
    ctaLabel: 'Go',
    active: true,
    ...overrides,
  };
}

describe('getActiveSlots', () => {
  it('keeps only active slots', () => {
    const slots = [
      slot({ id: 'a', active: true }),
      slot({ id: 'b', active: false }),
      slot({ id: 'c', active: true }),
    ];
    const result = getActiveSlots(slots);
    expect(result.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array when every slot is inactive', () => {
    const slots = [slot({ id: 'a', active: false }), slot({ id: 'b', active: false })];
    expect(getActiveSlots(slots)).toEqual([]);
  });

  it('returns every slot when all are active', () => {
    const slots = [slot({ id: 'a' }), slot({ id: 'b' })];
    expect(getActiveSlots(slots)).toHaveLength(2);
  });

  it('preserves order', () => {
    const slots = [slot({ id: 'first' }), slot({ id: 'second' }), slot({ id: 'third' })];
    expect(getActiveSlots(slots).map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
  });
});

describe('seeded slot inventories', () => {
  it('exposes unique ids within each inventory', () => {
    for (const inventory of [BANNER_SLOTS, CAROUSEL_SLOTS, SIDE_CARD_SLOTS]) {
      const ids = inventory.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('ships every seeded slot with copy and a destination', () => {
    for (const inventory of [BANNER_SLOTS, CAROUSEL_SLOTS, SIDE_CARD_SLOTS]) {
      for (const entry of inventory) {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.body.length).toBeGreaterThan(0);
        expect(entry.ctaLabel.length).toBeGreaterThan(0);
        expect(entry.href.length).toBeGreaterThan(0);
      }
    }
  });
});
