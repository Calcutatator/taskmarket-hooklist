// Verifies: ADR-0050
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
 * Operations that deliberately have no broadcaster, each with the reason it cannot have one.
 *
 * This list is the point of the test. An operation without a broadcaster spends its retry
 * budget immediately and falls to the refund path, which is worse for the payer than doing the
 * work -- so the absence has to be a decision somebody made and wrote down, not a gap somebody
 * left. Adding an entry here should feel like it needs an argument, because it does; the
 * argument itself lives next to the registration in `services/intents/register.ts`.
 *
 * This list was written when every entry was excluded because a *second landing* would move
 * money the chain would not stop. ADR-0054 has since closed both remaining hazards on chain,
 * so what is left here is unfinished wiring rather than a standing prohibition -- and the
 * entries say so. Keep that distinction explicit: an exclusion that stops recording *why* is
 * how a temporary gap becomes permanent.
 */
const NO_BROADCASTER: Record<string, string> = {
  'tasks.update':
    'Not yet wired, rather than unsafe. ADR-0054 made CoreFacet.updateTask revert NoRewardChange instead of silently applying a no-op reward change, so the forwarder-side delta transfer a replay would trigger is now unwound by the revert rather than kept. Giving this a broadcaster is unblocked follow-up work that has not been done.',
  'tasks.refundExpired':
    'Not yet wired, rather than unsafe. ADR-0054 made CoreFacet.refundExpired reject an already-Expired task and zero the liability it settles, so a second landing now reverts TaskAlreadyRefunded instead of draining pooled escrow. Giving this a broadcaster is unblocked follow-up work that has not been done.',
};

const EXPLANATION = [
  'Every relayed operation must either register a broadcaster or appear in this test\'s',
  'NO_BROADCASTER list with the reason it cannot have one. Without a broadcaster,',
  'dispatchRelayedIntent cannot turn the persisted payload back into a transaction, so it spends',
  'the intent\'s retry budget outright and drops it to the refund path -- the payer gets their',
  'money back instead of the thing they paid for, which is the exact asymmetry ADR-0050 exists',
  'to remove. If the new operation can safely be replayed, register a broadcast alongside its',
  'complete. If it cannot, add it here and state why next to its registration. See',
  'docs/adr/0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md.',
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
    // Guards the guard. A parse that silently returned nothing would make every assertion
    // below vacuously true, which is the failure mode a structural test most needs to avoid.
    expect(operations.length).toBeGreaterThan(20);
    expect(operations).toContain('tasks.create');
  });

  it('gives every operation either a broadcaster or a written reason for having none', () => {
    const missing = operations
      .filter((operation) => !getRelayedIntentBroadcaster(operation))
      .filter((operation) => !(operation in NO_BROADCASTER))
      .sort();

    expect(missing, EXPLANATION).toEqual([]);
  });

  it('keeps the exclusion list free of operations that do have a broadcaster', () => {
    // The other direction, and the one that rots quietly: an exclusion left behind after the
    // operation gained a broadcaster reads as a live decision that no longer holds.
    const stale = Object.keys(NO_BROADCASTER)
      .filter((operation) => Boolean(getRelayedIntentBroadcaster(operation)))
      .sort();

    expect(stale).toEqual([]);
  });

  it('keeps the exclusion list free of operations that no longer exist', () => {
    const unknown = Object.keys(NO_BROADCASTER)
      .filter((operation) => !operations.includes(operation))
      .sort();

    expect(unknown).toEqual([]);
  });

  it('requires each exclusion to carry a real reason, not a placeholder', () => {
    for (const [operation, reason] of Object.entries(NO_BROADCASTER)) {
      expect(reason.length, `${operation} needs a reason worth reading`).toBeGreaterThan(80);
    }
  });

  it('reads string literals out of the union and nothing else', () => {
    expect(
      declaredOperations(`export type RelayedIntentOperation = 'a.b' | 'c.d';`)
    ).toEqual(['a.b', 'c.d']);
    // A different union must not be mistaken for this one.
    expect(declaredOperations(`export type RelayedIntentStatus = 'recorded' | 'failed';`)).toEqual(
      []
    );
  });
});
