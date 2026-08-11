import { toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  KNOWN_ERRORS,
  PENDING_ERROR_OVERLAY,
  errorSignature,
  generatedErrors,
} from '../../../src/services/contract-errors';

/**
 * Extends the generated-ABI-as-source-of-truth rule (ADR-0065, which settled it for events) to
 * contract errors. Deliberately not tagged `Verifies:` for that ADR -- it decided event decoding,
 * and this map is a separate consumer of the same artifacts.
 *
 * The failure being guarded is quiet: an unmapped error decodes as no reason, which
 * `classifyRelayFailure` reads as transient, so the relayer re-sends a call that can only revert
 * again. Nothing errors; a paid write just retries until its window closes.
 */
describe('contract error selectors', () => {
  it('resolves a name for every error in every generated artifact', () => {
    // The whole point of deriving. Previously this held only for errors someone had remembered
    // to paste into a hand-written map, and twice it did not hold.
    const unmapped = generatedErrors().filter(
      ({ signature }) => !KNOWN_ERRORS[toFunctionSelector(signature).toLowerCase()]
    );

    expect(unmapped).toEqual([]);
  });

  it('covers every generated artifact, not just the Diamond', () => {
    // The hand map reached into four of these five and still missed errors in them. A regression
    // here would most likely be someone deriving from `TaskMarketABI` alone.
    const artifacts = new Set(generatedErrors().map(({ artifact }) => artifact));

    expect([...artifacts].sort()).toEqual([
      'EpochBudget',
      'RewardVault',
      'TaskMarket',
      'TaskMarketForwarder',
      'TaskTokenRewardHook',
    ]);
  });

  it.each(['RelayFailed()', 'ReceiptExpired()', 'ReceiptAlreadyConsumed()', 'CalldataTooShort()'])(
    'names the forwarder error %s, which every relayed call can hit',
    (signature) => {
      // The forwarder was not a generated artifact until this map derived from them, so a
      // derivation over the original four would have quietly dropped all eight of its errors --
      // the ones a relayed write reverts with most often, since every relayed call goes through
      // it. Deriving is only safer than a hand map if it covers everything the hand map did.
      expect(KNOWN_ERRORS[toFunctionSelector(signature)]).toBe(signature.replace('()', ''));
    }
  );

  it('maps SafeERC20FailedOperation, which a failed DREAMS transfer can reach', () => {
    // Called out in #504 as the one unmapped error that looked genuinely reachable rather than
    // owner-only: `wallet.withdrawDreams` calls the hook directly, and a failed token transfer
    // would otherwise have decoded as no reason and been retried as transient.
    const selector = toFunctionSelector('SafeERC20FailedOperation(address)');

    expect(KNOWN_ERRORS[selector]).toBe('SafeERC20FailedOperation');
  });

  it('assigns each selector exactly one name', () => {
    // Two errors sharing a selector would mean one silently decodes as the other. Derivation
    // makes this unlikely rather than impossible -- a four-byte hash can collide, and the map
    // is a plain object where the last writer wins without complaint.
    const bySelector = new Map<string, Set<string>>();
    for (const { name, signature } of generatedErrors()) {
      const selector = toFunctionSelector(signature).toLowerCase();
      bySelector.set(selector, (bySelector.get(selector) ?? new Set()).add(name));
    }

    const collisions = [...bySelector.entries()]
      .filter(([, names]) => names.size > 1)
      .map(([selector, names]) => `${selector}: ${[...names].join(', ')}`);

    expect(collisions).toEqual([]);
  });

  it('keeps the pending overlay free of errors the ABI already defines', () => {
    // What makes the overlay self-retiring. An entry belongs there only while the facet that
    // throws it is undeployed; once the upgrade lands, the derived base covers it and leaving it
    // behind turns a temporary exception into permanent hand-maintained state -- the thing this
    // whole change exists to remove.
    const derived = new Set(
      generatedErrors().map(({ signature }) => toFunctionSelector(signature).toLowerCase())
    );

    const retired = Object.entries(PENDING_ERROR_OVERLAY)
      .filter(([selector]) => derived.has(selector.toLowerCase()))
      .map(([selector, name]) => `${name} (${selector})`);

    expect(retired).toEqual([]);
  });

  it('builds a signature from an error argument types, not the word tuple', () => {
    // Hashing the literal "tuple" yields a selector no contract can emit, and the resulting entry
    // is silently inert -- it decodes nothing and fails nothing.
    const signature = errorSignature({
      inputs: [
        { type: 'address' },
        {
          components: [{ type: 'uint256' }, { type: 'address' }],
          type: 'tuple[]',
        },
      ],
      name: 'Example',
      type: 'error',
    });

    expect(signature).toBe('Example(address,(uint256,address)[])');
  });

  // Control selectors, computed rather than pasted, for errors that have been decoding real
  // reverts in production for a long time. If derivation were subtly wrong -- a bad signature
  // format, the wrong hash -- every assertion above would still pass while the map decoded
  // nothing, because they only ever compare derived values against other derived values.
  const CONTROLS: Record<string, string> = {
    '0x089087ea': 'SharesMustSumTo10000',
    '0xd93c0665': 'EnforcedPause',
    '0xe39da59e': 'NotRequester',
    '0xfe894217': 'TaskNotOpen',
  };

  it.each(Object.entries(CONTROLS))('decodes %s as %s, as it did before deriving', (sel, name) => {
    expect(KNOWN_ERRORS[sel]).toBe(name);
  });
});
