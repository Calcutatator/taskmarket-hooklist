// Verifies: ADR-0050
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const REGISTRATION_PATH = 'services/intents/register.ts';

/**
 * Tables whose rows are guard state: a row is what stops a second attempt at something.
 *
 * Short and explicit rather than inferred, because a list guessed from naming conventions
 * produces false positives, and a structural assertion that cries wolf gets deleted rather
 * than fixed. Add to it when a new guard table appears.
 */
const GUARD_TABLES = new Set(['dreamsWithdrawNonces', 'orphanedPayments']);

/** Guard releases are named for what they do; anything shaped like one is guarded. */
const RELEASE_EXPORT = /^release[A-Z].*(Nonce|Guard|Claim)$/;

/**
 * A release hands back the right to attempt something. That is only safe once the chain has
 * said the attempt failed, or once we have stopped attempting -- so it is declared on the
 * operation and invoked from settlement, never wired to whatever a request's send threw.
 */
const RELEASE_ALLOWLIST: Record<string, string> = {
  [REGISTRATION_PATH]:
    "Declares the operation's releaseGuard. Settlement resolves and runs it from the registry once the intent reaches `failed` (ADR-0050).",
  'services/relayed-intent-settlement.ts':
    'Invokes releaseIntentGuard immediately after writing `failed`, which it reaches only from a reverted receipt, a mined replacement, or an exhausted retry budget. The registry has one further call for the unpaid deterministic-revert branch it marks failed itself; that one is internal to the module that defines releaseIntentGuard, so no import brings it into view here.',
};

const RELEASE_EXPLANATION = [
  'A guard release may only be declared as an operation\'s `releaseGuard` in',
  `${REGISTRATION_PATH}, so that it runs from intent settlement and only there. Calling one`,
  'from a router -- or from an `onNotBroadcast` callback -- decides "nothing reached the chain"',
  'from a thrown error, which no thrown error establishes: `already known` means the',
  'transaction is in a mempool and can still mine, and a connection reset means the node may',
  'have taken it and we never heard back. Handing a replay guard back on either lets a captured',
  'signature be replayed against a call that is still live. See',
  'docs/adr/0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md.',
].join(' ');

const CALLBACK_EXPLANATION = [
  '`onNotBroadcast` runs on any non-pending error the send threw, which is not the same thing',
  'as the call not having happened. Only cleanup that is harmless in both directions belongs',
  'there -- a task-drop reservation, which costs nothing if released in error and expires on its',
  'own if it is never released. Touching guard state from it reopens the window that state',
  'exists to close. Declare a `releaseGuard` on the operation instead (ADR-0050).',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function parse(source: string, filename: string): ts.SourceFile {
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
}

/**
 * True when the source pulls in a guard release.
 *
 * Matched on the import rather than on a bare identifier, for the same reason ADR-0048's
 * assertion does: an alias or a namespace would otherwise walk straight past it. Matched on
 * the exported name rather than on the module path because the intent modules import each
 * other by relative sibling path, and a path-shaped rule would miss exactly the file that
 * matters most.
 */
export function importsGuardRelease(source: string, filename = 'source.ts'): boolean {
  const sourceFile = parse(source, filename);
  const namespaces = new Set<string>();
  let found = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (RELEASE_EXPORT.test(element.propertyName?.text ?? element.name.text)) found = true;
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      RELEASE_EXPORT.test(node.name.text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Every identifier appearing inside an `onNotBroadcast` callback, wherever one is written.
 *
 * Scoped to the callback's own subtree rather than to the whole file, so a router may still
 * import a guard table for the claim it makes before the chain call -- which is exactly where
 * that claim belongs -- while the callback stays unable to touch it.
 */
export function identifiersInNotBroadcastCallbacks(
  source: string,
  filename = 'source.ts'
): Set<string> {
  const sourceFile = parse(source, filename);
  const names = new Set<string>();

  function collect(node: ts.Node): void {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'onNotBroadcast'
    ) {
      collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

describe('who may release an intent guard', () => {
  it('allows a guard release to be wired only where the operation is registered', () => {
    const callers = sourceFiles(SRC_ROOT)
      .map((path) => relative(SRC_ROOT, path))
      // The intent modules define these functions; they are the thing guarded, not a caller.
      .filter((path) => !path.startsWith(join('services', 'intents') + '/') || path === REGISTRATION_PATH)
      .filter((path) => importsGuardRelease(readFileSync(join(SRC_ROOT, path), 'utf8'), path))
      .sort();

    expect(callers, RELEASE_EXPLANATION).toEqual(Object.keys(RELEASE_ALLOWLIST).sort());
  });

  it('keeps guard state unreachable from an onNotBroadcast callback', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .flatMap((path) => {
        const names = identifiersInNotBroadcastCallbacks(readFileSync(path, 'utf8'), path);
        const touched = [...names].filter(
          (name) => GUARD_TABLES.has(name) || RELEASE_EXPORT.test(name)
        );
        return touched.map((name) => `${relative(SRC_ROOT, path)}: ${name}`);
      })
      .sort();

    expect(offenders, CALLBACK_EXPLANATION).toEqual([]);
  });

  it('reads the release from the import, not from a naming convention in the body', () => {
    const direct = `import { releaseWalletWithdrawDreamsNonce } from './intents/wallet-intents';`;
    const aliased = `import { releaseWalletWithdrawDreamsNonce as hand } from './intents/wallet-intents';`;
    const namespaced = `import * as w from './intents/wallet-intents'; w.releaseWalletWithdrawDreamsNonce({});`;
    for (const source of [direct, aliased, namespaced]) expect(importsGuardRelease(source)).toBe(true);

    // Completing an intent is not releasing a guard, and neither is broadcasting one.
    expect(
      importsGuardRelease(`import { completeWalletWithdrawDreams } from './intents/wallet-intents';`)
    ).toBe(false);
    // A reservation release is not guard state: losing it in either direction is harmless.
    expect(
      importsGuardRelease(`import { releaseTaskDropReservation } from '../services/task-drops';`)
    ).toBe(false);
  });

  it('sees only inside the callback, so a claim made before the chain call still passes', () => {
    const claimThenRelease = `
      const rows = await ctx.db.insert(dreamsWithdrawNonces).values({ nonce }).returning();
      await runRelayedIntent({ send, onNotBroadcast: async () => {
        await ctx.db.delete(dreamsWithdrawNonces).where(eq(dreamsWithdrawNonces.nonce, nonce));
      } });
    `;
    expect(identifiersInNotBroadcastCallbacks(claimThenRelease)).toContain('dreamsWithdrawNonces');

    const claimOnly = `
      const rows = await ctx.db.insert(dreamsWithdrawNonces).values({ nonce }).returning();
      await runRelayedIntent({ send, onNotBroadcast: async () => releaseTaskDropReservation({}) });
    `;
    expect(identifiersInNotBroadcastCallbacks(claimOnly)).not.toContain('dreamsWithdrawNonces');
  });
});
