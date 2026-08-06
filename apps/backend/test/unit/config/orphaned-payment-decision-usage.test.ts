// Verifies: ADR-0048
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const LEDGER_PATH = 'services/orphaned-payments.ts';
const SETTLEMENT_PATH = 'services/relayed-intent-settlement.ts';
const STRANDED_PATH = 'services/relayed-intent-stranded.ts';

const GUARDED_EXPORTS = new Set([
  'handlePostPaymentFailure',
  'handleStandardFeePostPaymentFailure',
  'recordAndRefundOrphanedPayment',
]);

/**
 * Deciding that a payment is orphaned means deciding to refund it. ADR-0048 puts that
 * judgement in exactly one place -- an intent whose transaction the reconciler confirmed
 * failed -- because a router's catch block fires on any error at all, including a receipt
 * timeout, which is not a failure: the transaction is still live and may yet be mined, and
 * refunding then pays the payer back for work the chain goes on to do.
 *
 * Each exemption below is a place that either owns the ledger or holds a confirmed on-chain
 * verdict. Anywhere else, a call to one of these is the inline decision ADR-0048 removed.
 */
const DECISION_ALLOWLIST: Record<string, string> = {
  [SETTLEMENT_PATH]:
    'The sole decision path (ADR-0048): reached only from the reconciler verdict or from an intent that was provably never broadcast.',
  [STRANDED_PATH]:
    'The same decision on the same standard, for the one state settlement cannot reach: an intent whose send never returned a hash (ADR-0071). It refunds only on a chain read that names this intent alone -- the forwarder receipt its own call would have consumed, or the EIP-3009 authorization the user signed -- and only past the deadline the chain itself enforces. An unanswered read and an absence before that deadline both leave the intent untouched, so no timeout reaches this call here either.',
};

const FAILURE_EXPLANATION = [
  'Deciding a payment is orphaned means deciding to refund it, and ADR-0048 makes that a',
  'decision for intent settlement alone -- an intent whose transaction the reconciler',
  'confirmed failed, or one that provably never reached the chain. A router catch block',
  'cannot make it correctly: it fires on any error, including a receipt timeout, and a',
  'timeout is not a failure -- the transaction is live and may still be mined, so refunding',
  'there pays the payer back for work the chain then does anyway. Record a relayed intent',
  'before the chain call and let settlement decide, rather than adding an exemption here.',
  'See docs/adr/0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * True when the source decides an orphaned payment: it imports one of the guarded functions
 * under any name, reaches it through a namespace import, re-exports it, or pulls the module
 * in dynamically. Matching the import rather than a bare identifier is what stops a rename
 * from slipping past.
 */
export function decidesOrphanedPayment(source: string, filename = 'source.ts'): boolean {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const moduleNamespaces = new Set<string>();
  let found = false;

  const isLedgerModule = (specifier: string): boolean =>
    /(^|\/)orphaned-payments(\.js|\.ts)?$/.test(specifier);

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isLedgerModule(statement.moduleSpecifier.text)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) moduleNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (GUARDED_EXPORTS.has(element.propertyName?.text ?? element.name.text)) found = true;
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isLedgerModule(node.moduleSpecifier.text)
    ) {
      found = true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      moduleNamespaces.has(node.expression.text) &&
      GUARDED_EXPORTS.has(node.name.text)
    ) {
      found = true;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      isLedgerModule(node.arguments[0].text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Names imported from the contract service that read the chain rather than write to it.
 *
 * Matching on the import, and excluding by an explicit list rather than by a prefix guessed
 * from the body, is what keeps this from producing false positives -- the failure mode that
 * gets a structural assertion deleted rather than fixed. A read has no receipt and so nothing
 * that needs to outlive the request; `contractProjectSettlementForTx` is here for the same
 * reason, since it decodes a hash somebody else's write produced.
 */
const CHAIN_READ_IMPORTS =
  /^(contractGet|contractProjectSettlementForTx$|resolveRegisteredAgentId$)/;

/** True when the source imports something from the contract service that relays a write. */
export function relaysChainWrite(source: string, filename = 'source.ts'): boolean {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const isContractModule = (specifier: string): boolean =>
    /(^|\/)contract(\.js|\.ts)?$/.test(specifier);
  const isWrite = (name: string): boolean =>
    name.startsWith('contract') && !CHAIN_READ_IMPORTS.test(name);

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isContractModule(statement.moduleSpecifier.text)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    // A namespace import hides which members are used, so treat it as a write and let the
    // file prove otherwise by not being a router that relays. No router does this today.
    if (bindings && ts.isNamespaceImport(bindings)) return true;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (isWrite(element.propertyName?.text ?? element.name.text)) return true;
      }
    }
  }
  return false;
}

describe('who may decide a payment is orphaned', () => {
  it('allows the decision only in intent settlement', () => {
    const decisionSites = sourceFiles(SRC_ROOT)
      .map((path) => relative(SRC_ROOT, path))
      // The ledger defines these functions rather than calling them; it is the thing being
      // guarded, not a caller of it.
      .filter((path) => path !== LEDGER_PATH)
      .filter((path) => decidesOrphanedPayment(readFileSync(join(SRC_ROOT, path), 'utf8'), path))
      .sort();

    expect(decisionSites, FAILURE_EXPLANATION).toEqual(Object.keys(DECISION_ALLOWLIST).sort());
  });

  it('requires every router that relays a chain write to record an intent', () => {
    // Widened from "payer-gated" to "relays a write at all". Being paid was never what made
    // an intent necessary; it only made refunds necessary. An intent does two jobs, and the
    // second -- letting the post-receipt database work outlive the request -- applies to every
    // relayed write. A free write whose receipt lands after the request has gone diverges the
    // chain from the database just as silently as a paid one, with no payment involved to make
    // anybody notice.
    //
    // Coarse on purpose, and per-file rather than per-procedure, for the same reason as
    // before: deciding which `.mutation()` an import belongs to is the kind of inference that
    // produces false positives and gets an assertion disabled.
    const routers = sourceFiles(join(SRC_ROOT, 'routers'));
    const missing = routers
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return relaysChainWrite(source, path) && !source.includes('runRelayedIntent');
      })
      .map((path) => relative(SRC_ROOT, path))
      .sort();

    expect(
      missing,
      'A router that relays an on-chain write must record a relayed intent before making it (ADR-0045). The intent is what carries the post-receipt database work, so a receipt that outlives the request still lands in the database instead of leaving the chain and the database silently disagreeing -- and, where a payment is involved, what carries the reference settlement needs to refund it.'
    ).toEqual([]);
  });

  it('reads a relayed write from the import, not from a naming convention in the body', () => {
    const writes = `import { contractSubmitWork } from '../services/contract';`;
    const aliased = `import { contractClaimTask as claim } from '../services/contract';`;
    const namespaced = `import * as chain from '../services/contract'; chain.contractSubmitWork();`;
    for (const source of [writes, aliased, namespaced]) {
      expect(relaysChainWrite(source)).toBe(true);
    }

    // Reads are not writes: there is no receipt, so there is nothing to outlive the request.
    expect(
      relaysChainWrite(`import { contractGetDreamsClaimable } from '../services/contract';`)
    ).toBe(false);
    // Neither is projecting a settlement out of a hash somebody else's write produced.
    expect(
      relaysChainWrite(`import { contractProjectSettlementForTx } from '../services/contract';`)
    ).toBe(false);
    expect(relaysChainWrite(`import { z } from 'zod';`)).toBe(false);
  });

  it('catches a reintroduced inline decision under an alias, a namespace, or a dynamic import', () => {
    const bypasses = [
      `import { handlePostPaymentFailure as refund } from '../services/orphaned-payments'; refund({});`,
      `import { handleStandardFeePostPaymentFailure } from '../services/orphaned-payments';`,
      `import * as orphans from '../services/orphaned-payments'; orphans.recordAndRefundOrphanedPayment({});`,
      `export { handlePostPaymentFailure } from '../services/orphaned-payments';`,
      `const orphans = await import('../services/orphaned-payments'); orphans.handlePostPaymentFailure({});`,
      `const orphans = require('../services/orphaned-payments');`,
    ];

    for (const bypass of bypasses) expect(decidesOrphanedPayment(bypass)).toBe(true);

    // Reading the ledger is not deciding to write to it.
    expect(
      decidesOrphanedPayment(
        `import { retryFailedOrphanedRefunds } from '../services/orphaned-payments';`
      )
    ).toBe(false);
  });
});
