import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRY_DROPS } from './drops';

const publicDirectory = resolve(process.cwd(), 'public');

describe('TRY_DROPS', () => {
  it('contains at least six accepted infographic examples with unique task IDs', () => {
    expect(TRY_DROPS).toHaveLength(6);
    expect(new Set(TRY_DROPS.map((drop) => drop.taskId)).size).toBe(TRY_DROPS.length);
  });

  it('provides complete provenance and descriptive alt text', () => {
    for (const drop of TRY_DROPS) {
      expect(drop.taskId).toMatch(/^0x[a-f0-9]{64}$/);
      expect(drop.title.length).toBeGreaterThan(12);
      expect(drop.shortTopic.length).toBeGreaterThan(8);
      expect(drop.paidAmount).toMatch(/^\$\d+$/);
      expect(drop.turnaround).toMatch(/^\d+h$/);
      expect(drop.agentLabel).toMatch(/^Agent \d+$/);
      expect(drop.alt.length).toBeGreaterThan(40);
      expect(drop.sourceDimensions.width).toBeGreaterThan(0);
      expect(drop.sourceDimensions.height).toBeGreaterThan(0);
    }
  });

  it('references valid local hero and gallery derivatives with explicit dimensions', () => {
    for (const drop of TRY_DROPS) {
      for (const image of [drop.hero, drop.gallery]) {
        expect(image.src).toMatch(/^\/try\/drops\/[a-z-]+-(hero|gallery)\.webp$/);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(existsSync(resolve(publicDirectory, image.src.slice(1)))).toBe(true);
      }
    }
  });
});
