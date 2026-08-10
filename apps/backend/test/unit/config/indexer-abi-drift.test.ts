import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { toEventSelector, type AbiEvent } from 'viem';
import {
  EPOCH_BUDGET_INDEXED_EVENT_NAMES,
  EPOCH_BUDGET_UNINDEXED_EVENTS,
  GENERATED_EVENT_ITEMS,
  GENERATED_EVENT_NAMES,
  HISTORICAL_MAIN_EVENTS,
  MAIN_INDEXED_EVENT_NAMES,
  MAIN_UNINDEXED_EVENTS,
  PENDING_MAIN_EVENTS,
  REWARD_HOOK_INDEXED_EVENT_NAMES,
  REWARD_HOOK_UNINDEXED_EVENTS,
  REWARD_VAULT_INDEXED_EVENT_NAMES,
  REWARD_VAULT_UNINDEXED_EVENTS,
} from '../../../src/services/indexer-abi-events';

/**
 * The indexer subscribes to on-chain events by topic0. An event the contracts emit but
 * the indexer does not list is never fetched by viem's getLogs, never decoded, and never
 * reaches any default branch -- it is dropped with no error and no log line. Nothing
 * else in the repo compares the two sets.
 *
 * These tests close that hole from both directions:
 *   - every event in the generated ABI is either indexed or explicitly allowlisted, so
 *     adding an event to the contracts fails the build until someone decides about it;
 *   - every indexed name has a handler, so a filtered event cannot fall through.
 *
 * The generated ABI files themselves are kept current by CI's `make contract abi-check`
 * (.github/workflows/ci.yml, quality-contracts) -- without that these tests would only
 * be as good as the last time someone remembered to run `make build contracts`.
 */
describe('indexer ABI drift guard', () => {
  const cases = [
    {
      contract: 'TaskMarket' as const,
      indexed: MAIN_INDEXED_EVENT_NAMES as readonly string[],
      unindexed: MAIN_UNINDEXED_EVENTS,
    },
    {
      contract: 'TaskTokenRewardHook' as const,
      indexed: REWARD_HOOK_INDEXED_EVENT_NAMES as readonly string[],
      unindexed: REWARD_HOOK_UNINDEXED_EVENTS,
    },
    {
      contract: 'RewardVault' as const,
      indexed: REWARD_VAULT_INDEXED_EVENT_NAMES as readonly string[],
      unindexed: REWARD_VAULT_UNINDEXED_EVENTS,
    },
    {
      contract: 'EpochBudget' as const,
      indexed: EPOCH_BUDGET_INDEXED_EVENT_NAMES as readonly string[],
      unindexed: EPOCH_BUDGET_UNINDEXED_EVENTS,
    },
  ];

  for (const { contract, indexed, unindexed } of cases) {
    it(`accounts for every ${contract} event in the generated ABI`, () => {
      const accounted = new Set([...indexed, ...Object.keys(unindexed)]);
      const unaccounted = GENERATED_EVENT_NAMES[contract].filter((name) => !accounted.has(name));
      expect(
        unaccounted,
        `${contract} emits ${unaccounted.join(', ')}, which the indexer neither indexes nor ` +
          `allowlists. Add each to the INDEXED list (and give it a handler) or to the ` +
          `UNINDEXED map with a reason, in src/services/indexer-abi-events.ts.`
      ).toEqual([]);
    });

    it(`does not allowlist ${contract} events that no longer exist`, () => {
      const generated = new Set<string>(GENERATED_EVENT_NAMES[contract]);
      const stale = Object.keys(unindexed).filter((name) => !generated.has(name));
      expect(stale, `${contract} no longer emits ${stale.join(', ')}`).toEqual([]);
    });
  }

  it('keeps historical signatures that are genuinely superseded', () => {
    for (const [name, event] of Object.entries(HISTORICAL_MAIN_EVENTS)) {
      const current = GENERATED_EVENT_ITEMS.TaskMarket.get(name);
      expect(current, `${name} is no longer in the generated ABI at all`).toBeDefined();
      expect(
        toEventSelector(event),
        `HISTORICAL_MAIN_EVENTS.${name} matches the current signature, so it is redundant`
      ).not.toEqual(toEventSelector(current as AbiEvent));
    }
  });

  it('keeps pending signatures aligned once the contracts catch up', () => {
    for (const [name, event] of Object.entries(PENDING_MAIN_EVENTS)) {
      const current = GENERATED_EVENT_ITEMS.TaskMarket.get(name);
      if (!current) continue; // the revision declaring it has not merged here yet
      expect(
        toEventSelector(event),
        `${name} now exists in the generated ABI but PENDING_MAIN_EVENTS.${name} does not ` +
          `match it. Move it to MAIN_INDEXED_EVENT_NAMES and delete the literal.`
      ).toEqual(toEventSelector(current as AbiEvent));
    }
  });

  it('has a dispatch case for every indexed main-contract event', () => {
    // dispatchMainEvent is a switch, and importing indexer.ts here would pull in the
    // database client and server config. Reading the source is enough to prove no
    // filtered event falls through to `default: return false`.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/services/indexer.ts', import.meta.url)),
      'utf8'
    );
    const handled = new Set([
      ...[...source.matchAll(/^\s*case '([A-Za-z0-9_]+)':/gm)].map((match) => match[1]),
      // TaskCompleted is intercepted ahead of the switch in processEvents, because a
      // settlement is projected from a whole group of payout logs at once.
      ...[...source.matchAll(/log\.eventName === '([A-Za-z0-9_]+)'/g)].map((match) => match[1]),
    ]);
    const pending = Object.keys(PENDING_MAIN_EVENTS);
    const missing = [...MAIN_INDEXED_EVENT_NAMES, ...pending].filter((name) => !handled.has(name));
    expect(
      missing,
      `indexer.ts filters for ${missing.join(', ')} but dispatchMainEvent has no case for them`
    ).toEqual([]);
  });
});
