import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

// KNOWN_ERRORS lives in a module that reads deployment env at import time, so this reads the
// selector map out of the source text rather than importing it. What matters is the pairing,
// and the pairing is fully visible in the literal.
const SOURCE = readFileSync(
  join(fileURLToPath(new URL('.', import.meta.url)), '../../../src/services/contract.ts'),
  'utf8'
);

function knownErrors(): Record<string, string> {
  const body = SOURCE.split('const KNOWN_ERRORS: Record<string, string> = {')[1]?.split('\n};')[0];
  if (!body) throw new Error('KNOWN_ERRORS literal not found in contract.ts');
  const map: Record<string, string> = {};
  for (const [, selector, name] of body.matchAll(/'(0x[0-9a-f]{8})':\s*'(\w+)'/g)) {
    map[selector!] = name!;
  }
  if (Object.keys(map).length === 0) throw new Error('KNOWN_ERRORS parsed as empty');
  return map;
}

// A wrong selector is silently inert -- it decodes nothing, and nothing fails. So the
// expected value is computed here rather than pasted, and the computation is itself checked
// against entries that have been in the map (and decoding real reverts) for a long time.
describe('KNOWN_ERRORS selectors', () => {
  const map = knownErrors();

  const CONTROLS = [
    'TaskNotOpen()',
    'NotRequester()',
    'RewardMustBeGreaterThanZero()',
    'InvalidAuctionSubtype()',
    'SharesMustSumTo10000()',
    'RelayFailed()',
  ];

  // Errors from contract revisions not yet deployed. Mapped ahead of the upgrade because an
  // unmapped revert decodes as "unknown revert", which classifyRelayFailure treats as
  // transient and retries forever against a call that can only revert again.
  const PENDING = [
    // rev016 -- escrow liability
    'TaskAlreadyRefunded()',
    'NoRewardChange()',
    // rev017 -- escrow payout bypass and hook return-data DoS
    'EvaluatorCannotBeRequester()',
    'DisputeResolverCannotBeRequester()',
    'AppealWindowTooShort()',
    'InvalidMinAppealWindow()',
  ];

  it.each(CONTROLS)('computes the existing selector for %s', (signature) => {
    const selector = toFunctionSelector(signature);
    expect(map[selector]).toBe(signature.replace('()', ''));
  });

  it.each(PENDING)('maps %s so a revert never decodes as unknown', (signature) => {
    const selector = toFunctionSelector(signature);
    expect(map[selector]).toBe(signature.replace('()', ''));
  });
});
