// Verifies: ADR-0040
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

// Every viem client method that broadcasts a transaction, and therefore consumes a nonce.
// The dispatcher owns nonce allocation, so any of these outside it can reuse a nonce the
// allocator already handed out. viem's nonce manager no longer backstops this (ADR-0040).
const BROADCASTING_METHODS = new Set([
  'deployContract',
  'sendRawTransaction',
  'sendTransaction',
  'writeContract',
]);

// lib/wallet.ts owns the dispatcher and the reconciler. Its replacement transaction is
// deliberately sent outside dispatch(): it targets a nonce the allocator has already issued
// and is clearing, so routing it through allocation would defeat its purpose.
const EXEMPT_FILES = new Set(['lib/wallet.ts']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function unguardedBroadcastCalls(path: string): { line: number; method: string }[] {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const findings: { line: number; method: string }[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      BROADCASTING_METHODS.has(node.expression.name.text)
    ) {
      let ancestor: ts.Node | undefined = node.parent;
      let guarded = false;
      while (ancestor) {
        if (
          ts.isCallExpression(ancestor) &&
          ts.isIdentifier(ancestor.expression) &&
          ancestor.expression.text === 'dispatchServerWalletTransaction'
        ) {
          guarded = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (!guarded) {
        findings.push({
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          method: node.expression.name.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

describe('server wallet transaction usage', () => {
  it('routes every runtime broadcasting call through the shared dispatcher', () => {
    const unguarded = sourceFiles(SRC_ROOT)
      .map((path) => ({ path, relativePath: relative(SRC_ROOT, path) }))
      .filter(
        ({ relativePath }) =>
          !relativePath.startsWith('scripts/') && !EXEMPT_FILES.has(relativePath)
      )
      .flatMap(({ path, relativePath }) =>
        unguardedBroadcastCalls(path).map(
          (finding) => `${relativePath}:${finding.line} (${finding.method})`
        )
      );

    expect(
      unguarded,
      'Runtime transaction broadcasts must be nested inside dispatchServerWalletTransaction()'
    ).toEqual([]);
  });
});
