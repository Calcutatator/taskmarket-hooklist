// Verifies: ADR-0045, ADR-0048
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * The one function that raises `ServerTransactionPendingError`, and the module that owns it.
 *
 * Everything else only ever re-raises what this threw, so a `try` that reaches it is the whole
 * population of places the error can appear from.
 */
const DISPATCHER = 'dispatchServerWalletTransaction';
const DISPATCHER_PATH = 'lib/server-transaction-dispatcher.ts';

const FAILURE_EXPLANATION = [
  'A pending transaction is not a failed one. `dispatchServerWalletTransaction` raises',
  '`ServerTransactionPendingError` when a transaction was broadcast and its receipt did not',
  'arrive in time -- it has a hash, it is in the mempool, and the reconciler owns its outcome.',
  'A catch block around that call which does not name the error treats it as a failure: it',
  'retries (a second nonce on live work), marks a row failed (a sweep re-claims it and sends a',
  'second transfer), or refunds a payment for work that then lands on chain. Every one of those',
  'has been a real defect here. Name the error in the catch and decide about it explicitly --',
  'rethrow it, or persist the hash it carries -- rather than letting it fall into the branch',
  'written for failures. See ADR-0045 and ADR-0048.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function containsIdentifier(node: ts.Node, name: string): boolean {
  let found = false;
  function visit(current: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(current) && current.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

/**
 * Lines of every catch block whose `try` dispatches a server-wallet transaction and which does
 * not mention `ServerTransactionPendingError`.
 *
 * Lexical containment is the right test and not an approximation of one: the error is raised by
 * a call the `try` makes directly, so a `try` that does not name the dispatcher cannot see it
 * except through a callee that has already been checked by this same rule at its own site.
 */
export function unguardedDispatchCatches(source: string, filename = 'source.ts'): number[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (ts.isTryStatement(node) && node.catchClause) {
      if (
        containsIdentifier(node.tryBlock, DISPATCHER) &&
        !containsIdentifier(node.catchClause, 'ServerTransactionPendingError')
      ) {
        lines.push(
          sourceFile.getLineAndCharacterOfPosition(node.catchClause.getStart(sourceFile)).line + 1
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines;
}

describe('a catch around a server-wallet dispatch', () => {
  it('never swallows ServerTransactionPendingError', () => {
    const offenders = sourceFiles(SRC_ROOT).flatMap((path) => {
      const relativePath = relative(SRC_ROOT, path).split('\\').join('/');
      // The dispatcher raises the error; its own internals are what the rule is written about.
      if (relativePath === DISPATCHER_PATH) return [];
      return unguardedDispatchCatches(readFileSync(path, 'utf8'), relativePath).map(
        (line) => `${relativePath}:${line}`
      );
    });

    expect(offenders, FAILURE_EXPLANATION).toEqual([]);
  });

  it('detects the shape of the defect it exists for', () => {
    // The relay retry loop as it stood: a broad catch that recorded the error and tried again,
    // so the hash never reached the two callers written to persist it and the intent stayed
    // indistinguishable from one that was never sent.
    const reintroduced = [
      'for (let attempt = 0; attempt < 6; attempt++) {',
      '  try {',
      '    const result = await dispatchServerWalletTransaction({ send });',
      '    return result;',
      '  } catch (err) {',
      '    lastError = err;',
      '    continue;',
      '  }',
      '}',
    ].join('\n');

    expect(unguardedDispatchCatches(reintroduced)).toEqual([5]);
  });

  it('accepts a catch that decides about the error explicitly', () => {
    const guarded = [
      'try {',
      '  return await dispatchServerWalletTransaction({ send });',
      '} catch (err) {',
      '  if (err instanceof ServerTransactionPendingError) throw err;',
      '  return null;',
      '}',
    ].join('\n');

    expect(unguardedDispatchCatches(guarded)).toEqual([]);
  });
});
