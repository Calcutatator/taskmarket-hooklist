// Verifies: ADR-0050
// Verifies: ADR-0054
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const OPERATIONS_PATH = join(SRC_ROOT, 'services', 'relayed-intents.ts');

/**
 * Every contract wrapper stubbed, without naming them.
 *
 * This test never broadcasts anything -- it only needs the registration to run -- so the stubs
 * exist purely to satisfy the imports. `then` is excluded deliberately: vitest awaits the module
 * namespace, and a `then` that looked callable would make the module a thenable that never
 * resolves, which hangs the run rather than failing it.
 */
vi.mock('../../../src/services/contract', () => {
  const stubs = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== 'string' || key === 'then') return undefined;
        if (!stubs.has(key)) stubs.set(key, vi.fn());
        return stubs.get(key);
      },
      has: () => true,
    }
  );
});

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
    DEFAULT_PLATFORM_FEE_BPS: 500,
  }),
}));

const { registerRelayedIntentHandlers } = await import('../../../src/services/intents/register');
const { getRelayedIntentBroadcaster } = await import(
  '../../../src/services/relayed-intent-registry'
);

registerRelayedIntentHandlers();

/**
 * Every relayed operation must be reconstructible from its persisted payload alone.
 *
 * ADR-0050 retries an intent that provably never reached the chain rather than refunding it,
 * and that is only possible for an operation with a broadcaster -- a way to turn the jsonb
 * payload back into the same transaction, in a process that never served the original request.
 * Without one, `dispatchRelayedIntent` spends the intent's retry budget outright and drops it to
 * the refund path: the payer gets their money back instead of the thing they paid for, which is
 * the exact asymmetry ADR-0050 exists to remove.
 *
 * So this is a flat requirement with no exemption available. An operation added to the
 * `RelayedIntentOperation` union without a broadcaster fails the build, and there is nowhere to
 * record an excuse -- deliberately, because a list of excuses is where a temporary gap becomes
 * permanent. There used to be one, holding `tasks.update` and `tasks.refundExpired`; both were
 * on it because a second landing would have moved money the chain would not stop, and ADR-0054
 * closed both hazards on chain (`NoRewardChange`, `TaskAlreadyRefunded`) rather than by
 * argument.
 *
 * That is the precedent to follow. If a future operation genuinely cannot be replayed safely,
 * the answer is to fix whatever makes it unsafe -- usually a missing guard on chain, sometimes a
 * payload carrying something state-derived it should not -- not to reintroduce a list.
 */
const EXPLANATION = [
  'Every relayed operation must register a broadcaster. Without one, dispatchRelayedIntent',
  "cannot turn the persisted payload back into a transaction, so it spends the intent's retry",
  'budget outright and drops it to the refund path -- the payer gets their money back instead of',
  'the thing they paid for, which is the exact asymmetry ADR-0050 exists to remove. There is no',
  'exemption list. If this operation cannot be safely replayed, fix what makes it unsafe (as',
  'ADR-0054 did for tasks.update and tasks.refundExpired) rather than shipping it unreplayable.',
  'See docs/adr/0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md.',
].join(' ');

/**
 * The `RelayedIntentOperation` union, read out of the source rather than imported.
 *
 * A type union does not exist at runtime, so the closed list of what can be recorded is only
 * available by parsing it. Reading it here is what makes this test fail for an operation
 * somebody adds to the union and forgets everywhere else -- which is the failure it is for.
 */
export function declaredOperations(source: string, filename = 'source.ts'): string[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text !== 'RelayedIntentOperation') continue;
    if (!ts.isUnionTypeNode(statement.type)) continue;
    for (const member of statement.type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        names.push(member.literal.text);
      }
    }
  }

  return names;
}

describe('broadcaster coverage across every relayed operation', () => {
  const operations = declaredOperations(readFileSync(OPERATIONS_PATH, 'utf8'), OPERATIONS_PATH);

  it('finds the operation union it is meant to be checking', () => {
    // Guards the guard, and matters more now that the requirement below has no exemption path to
    // fail on: a parse that silently returned nothing would make the whole test vacuously true,
    // which is the failure mode a structural test most needs to avoid.
    expect(operations.length).toBeGreaterThan(20);
    expect(operations).toContain('tasks.create');
  });

  it('registers a broadcaster for every operation', () => {
    const missing = operations.filter((operation) => !getRelayedIntentBroadcaster(operation)).sort();

    expect(missing, EXPLANATION).toEqual([]);
  });

  it('covers the two operations ADR-0054 unblocked', () => {
    // Named rather than left to the sweep above, because these are the ones that were excluded
    // on a money argument. If either loses its broadcaster, the reason should be re-argued
    // against ADR-0054, not absorbed silently into a general count.
    expect(getRelayedIntentBroadcaster('tasks.update')).toBeTypeOf('function');
    expect(getRelayedIntentBroadcaster('tasks.refundExpired')).toBeTypeOf('function');
  });

  it('reads string literals out of the union and nothing else', () => {
    expect(declaredOperations(`export type RelayedIntentOperation = 'a.b' | 'c.d';`)).toEqual([
      'a.b',
      'c.d',
    ]);
    // A different union must not be mistaken for this one.
    expect(declaredOperations(`export type RelayedIntentStatus = 'recorded' | 'failed';`)).toEqual(
      []
    );
  });
});
