// Verifies: ADR-0050
import { afterAll, describe, expect, it } from 'vitest';
import { EvaluateInputSchema, ResolveDisputeInputSchema } from '@taskmarket/shared';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { VERDICT_MAP, verdictCode } = await import(
  '../../../src/services/intents/evaluations-intents'
);

afterAll(restoreServerEnvironment);

describe('verdictCode', () => {
  /**
   * The runtime witness for a guarantee the type system already makes: `VERDICT_MAP` is declared
   * as a total map over the verdict union the request schemas publish, so adding a member to
   * either schema without adding it here stops compiling. This test is what keeps the guarantee
   * if that declaration is ever widened back to `Record<string, number>`.
   */
  it('maps every verdict the request schemas accept, and nothing else', () => {
    const declared = [
      ...new Set([
        ...EvaluateInputSchema.shape.verdict.options,
        ...ResolveDisputeInputSchema.shape.verdict.options,
      ]),
    ];

    for (const verdict of declared) {
      expect(() => verdictCode(verdict), `verdict "${verdict}" has no on-chain code`).not.toThrow();
    }
    // Equality, not containment: an extra entry here is a code the API cannot ask for, which is
    // a mapping nobody validates.
    expect(Object.keys(VERDICT_MAP).sort()).toEqual(declared.sort());
  });

  it('refuses a verdict outside the vocabulary rather than approving it', () => {
    // The whole point. `VERDICT_MAP[verdict] ?? 0` returned 0 here -- APPROVE -- and paid the
    // awards out for a verdict it could not interpret.
    expect(() => verdictCode('escalate')).toThrow(/unknown verdict/);
    expect(verdictCode('approve')).toBe(0);
  });
});
