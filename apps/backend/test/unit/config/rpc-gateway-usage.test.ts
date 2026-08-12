import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const GATEWAY_PATH = 'lib/rpc-gateway.ts';
const GUARDED_EXPORTS = new Set([
  'createClient',
  'createPublicClient',
  'createTestClient',
  'createWalletClient',
  'http',
  'webSocket',
]);

// These are independent command-line processes, not long-lived backend runtime clients.
// Every exemption is deliberately named so a new script cannot silently bypass the gateway.
const STANDALONE_CLIENT_ALLOWLIST: Record<string, string> = {
  'scripts/_x402.ts': 'X402 smoke helper signs and verifies against an explicitly selected stack.',
  'scripts/smoke-payment-orphan-refund.ts':
    'Orphan-refund smoke test owns isolated requester and owner clients.',
  'scripts/smoke-nonce.ts':
    'Nonce smoke test reads the relayer nonce straight from the chain to compare it against the allocator, so it must not share the backend gateway.',
  'scripts/smoke-rater-agent-id.ts': 'Rater smoke test reads a standalone testnet deployment.',
  'scripts/smoke-token-reward-hook.ts':
    'Reward-hook smoke test deploys fixtures with an isolated deployer.',
  'scripts/smoke-upgrade.ts': 'Upgrade smoke test owns isolated proxy owner clients.',
  'scripts/migrate-reward-hook-state.ts':
    'Reward-hook state migration is a one-shot operator process that must target one explicitly chosen network. It picks its RPC from NETWORK and asserts the connected chain ID before reading, precisely so it cannot inherit whichever chain the backend happens to be configured for.',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function containsRpcClientConstruction(source: string, filename = 'source.ts'): boolean {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const guardedIdentifiers = new Set<string>();
  const viemNamespaces = new Set<string>();
  let found = false;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'viem'
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) viemNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (GUARDED_EXPORTS.has(importedName)) {
          guardedIdentifiers.add(element.name.text);
          found = true;
        }
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'viem' &&
      (!node.exportClause ||
        (ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some((element) =>
            GUARDED_EXPORTS.has(element.propertyName?.text ?? element.name.text)
          )))
    ) {
      found = true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      viemNamespaces.has(node.expression.text) &&
      GUARDED_EXPORTS.has(node.name.text)
    ) {
      found = true;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && guardedIdentifiers.has(node.expression.text)) {
        found = true;
      }
      if (
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === 'viem'
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function constructsRpcClient(path: string): boolean {
  return containsRpcClientConstruction(readFileSync(path, 'utf8'), path);
}

describe('runtime RPC client construction', () => {
  it('allows construction only in the gateway and explicitly documented standalone scripts', () => {
    const constructionSites = sourceFiles(SRC_ROOT)
      .filter(constructsRpcClient)
      .map((path) => relative(SRC_ROOT, path))
      .sort();
    const approvedSites = [GATEWAY_PATH, ...Object.keys(STANDALONE_CLIENT_ALLOWLIST)].sort();

    expect(constructionSites, 'RPC construction sites must have a specific reviewed exemption').toEqual(
      approvedSites
    );
  });

  it('detects aliases, namespace access, re-exports, and dynamic imports', () => {
    const bypasses = [
      `import { createPublicClient as makeClient } from "viem"; makeClient({});`,
      `import * as viem from 'viem'; const makeClient = viem.createWalletClient; makeClient({});`,
      `export { createPublicClient as makeClient } from 'viem';`,
      `const viem = await import('viem'); viem.createPublicClient({});`,
      `const viem = require('viem'); viem.createPublicClient({});`,
    ];

    for (const bypass of bypasses) expect(containsRpcClientConstruction(bypass)).toBe(true);
    expect(containsRpcClientConstruction(`import { parseAbi } from 'viem'; parseAbi([]);`)).toBe(
      false
    );
  });
});
