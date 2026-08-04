// Verifies: ADR-0049
// Verifies: ADR-0052
// Verifies: ADR-0058
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_ERROR_REASONS, type ApiErrorReason } from '@taskmarket/shared';

import { codeForReason } from '../../../src/lib/api-error';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * The paths a paid write actually travels, and the only ones this guard covers.
 *
 * ADR-0058 does not require every one of this backend's 270-odd throw sites to be classified --
 * an unclassified `BAD_REQUEST` on a validation path costs a caller a retry, not a payment. It
 * requires it here, where the difference between "still landing" and "definitively failed" is the
 * difference between waiting and paying twice, and where the absence of a discriminator has
 * already been paid for: four literal substrings in the web app, and a CLI that cannot tell the
 * two apart at all.
 *
 * A file added to this path that nobody adds to this list is unguarded. That is the same
 * limitation the neighbouring guards carry, and it is why the list is a directory prefix wherever
 * one exists rather than a hand-kept enumeration of files.
 */
const GUARDED_FILES = [
  'services/relayed-intent-request.ts',
  'services/relayed-intents.ts',
  'middleware/x402.ts',
  'routers/intents.router.ts',
];
const GUARDED_DIRECTORIES = ['services/intents'];

const BARE_THROW_EXPLANATION = [
  'A relayed-write path may not construct a bare `TRPCError`. ADR-0049 point 3 requires a caller',
  'to tell "in flight" from "failed" by a field, never by string-matching a message, and a',
  '`TRPCError` carries only a coarse code and prose -- `BAD_REQUEST` alone covers over a hundred',
  'conditions in this backend. Throw `apiError({ reason, message, ... })` from',
  '`src/lib/api-error.ts` instead, choosing the reason that names what actually happened.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function guardedFiles(): string[] {
  const fromDirectories = GUARDED_DIRECTORIES.flatMap((directory) =>
    sourceFiles(join(SRC_ROOT, directory)).map((path) => relative(SRC_ROOT, path))
  );
  return [...GUARDED_FILES, ...fromDirectories].sort();
}

/** Every `new TRPCError({ ... })` construction in a source, by line. */
export function bareTrpcErrorSites(source: string, filename = 'source.ts'): number[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'TRPCError'
    ) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines;
}

/**
 * True when a source rethrows the identifier it caught, from a branch that tested it against
 * `ServerTransactionPendingError`.
 *
 * This is the specific regression the whole change exists to end, so it is asserted specifically
 * rather than trusted to fall out of the bare-TRPCError rule -- a raw rethrow constructs nothing
 * at all, so nothing else here would notice it.
 */
export function rethrowsPendingErrorRaw(source: string, filename = 'source.ts'): boolean {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (
      ts.isIfStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      node.expression.right.getText(sourceFile) === 'ServerTransactionPendingError'
    ) {
      const subject = node.expression.left.getText(sourceFile);
      const scan = (child: ts.Node): void => {
        if (
          ts.isThrowStatement(child) &&
          child.expression &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === subject
        ) {
          found = true;
        }
        ts.forEachChild(child, scan);
      };
      scan(node.thenStatement);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Procedures whose implementation calls `runRelayedIntent`, and whether their OpenAPI meta
 * declares the idempotency header.
 *
 * A relayed write requires `Idempotency-Key` and is a 400 without one (ADR-0052). While the spec
 * did not say so, a raw-REST caller reading the machine-readable contract had no way to learn
 * about a requirement that would reject every request they made.
 */
export function relayedProcedureHeaderDeclarations(
  source: string,
  filename = 'source.ts'
): { line: number; declaresHeaders: boolean }[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const found: { line: number; declaresHeaders: boolean }[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'meta' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const openapi = node.arguments[0].properties.find(
        (property) =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'openapi'
      ) as ts.PropertyAssignment | undefined;

      if (openapi && ts.isObjectLiteralExpression(openapi.initializer)) {
        // The whole builder chain, so the question "does this procedure relay an intent" is asked
        // of the handler rather than of the meta object it sits beside.
        let chain: ts.Node = node;
        while (
          chain.parent &&
          (ts.isPropertyAccessExpression(chain.parent) || ts.isCallExpression(chain.parent))
        ) {
          chain = chain.parent;
        }
        if (chain.getText(sourceFile).includes('runRelayedIntent')) {
          found.push({
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            declaresHeaders: openapi.initializer.properties.some(
              (property) => property.name?.getText(sourceFile) === 'requestHeaders'
            ),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

describe('how a relayed-write path reports failure', () => {
  it('constructs no bare TRPCError anywhere a paid write can fail', () => {
    const bare = guardedFiles()
      .flatMap((relativePath) => {
        const source = readFileSync(join(SRC_ROOT, relativePath), 'utf8');
        return bareTrpcErrorSites(source, relativePath).map((line) => `${relativePath}:${line}`);
      })
      .sort();

    expect(bare, BARE_THROW_EXPLANATION).toEqual([]);
  });

  it('never rethrows ServerTransactionPendingError raw', () => {
    // The original defect, asserted by name. Rethrowing it raw is what made an in-flight write
    // arrive as an HTTP 500 whose prose was the only evidence it was still alive, which is what
    // the web app's four substring markers were written to guess at.
    const raw = guardedFiles().filter((relativePath) =>
      rethrowsPendingErrorRaw(readFileSync(join(SRC_ROOT, relativePath), 'utf8'), relativePath)
    );

    expect(
      raw,
      'An in-flight outcome must be translated into `apiError({ reason: "intent_in_flight", ... })` carrying the intent id and status, not rethrown as a `ServerTransactionPendingError`. Rethrown raw it reaches the client as a 500 with a sentence, which is the exact state ADR-0049 point 3 exists to end.'
    ).toEqual([]);
  });

  it('gives every declared reason exactly one status, with no reason left unmapped', () => {
    // `REASON_CODES` is a `Record<ApiErrorReason, ...>`, so this cannot fail while the file
    // compiles. It is asserted anyway because the property that matters is the runtime one: a
    // reason reaching a client with no status decided for it.
    const unmapped = API_ERROR_REASONS.filter(
      (reason: ApiErrorReason) => codeForReason(reason) === undefined
    );

    expect(
      unmapped,
      'Every ApiErrorReason must have a status in REASON_CODES (src/lib/api-error.ts). A reason with no mapping answers with whatever status the nearest throw happened to use, which is the situation the reason exists to replace.'
    ).toEqual([]);
  });

  it('publishes the envelope on every tRPC error rather than on the ones somebody remembered', () => {
    // Per-router attachment would make "every error carries a discriminator" a convention with
    // exceptions, and a client that has to test whether the field is present before branching on
    // it is back to reading the message whenever it is not.
    const trpc = readFileSync(join(SRC_ROOT, 'trpc.ts'), 'utf8');

    expect(trpc).toContain('errorFormatter');
    expect(trpc).toContain('envelopeForError');
  });

  it('declares the idempotency header on every relayed write that has an OpenAPI route', () => {
    const undeclared = sourceFiles(join(SRC_ROOT, 'routers'))
      .flatMap((path) => {
        const relativePath = relative(SRC_ROOT, path);
        return relayedProcedureHeaderDeclarations(readFileSync(path, 'utf8'), relativePath)
          .filter((procedure) => !procedure.declaresHeaders)
          .map((procedure) => `${relativePath}:${procedure.line}`);
      })
      .sort();

    expect(
      undeclared,
      'A relayed write requires an Idempotency-Key header and answers 400 without one (ADR-0052). Add `requestHeaders: RELAYED_WRITE_REQUEST_HEADERS` to its `openapi` meta, so a raw-REST caller reading the spec learns about the requirement from the contract rather than from the rejection.'
    ).toEqual([]);
  });

  it('finds a bare throw, a raw rethrow and a missing header declaration, rather than matching on text', () => {
    // The detectors, exercised against sources shaped like the mistakes they exist to catch. A
    // guard nobody has seen fail is a guard nobody knows works.
    const bare = `throw new TRPCError({ code: 'CONFLICT', message: 'x' });`;
    const classified = `throw apiError({ reason: 'intent_in_flight', message: 'x' });`;
    expect(bareTrpcErrorSites(bare)).toEqual([1]);
    expect(bareTrpcErrorSites(classified)).toEqual([]);

    const rethrown = `
      try { a(); } catch (error) {
        if (error instanceof ServerTransactionPendingError) { await link(); throw error; }
        throw error;
      }`;
    const translated = `
      try { a(); } catch (error) {
        if (error instanceof ServerTransactionPendingError) {
          await link();
          throw apiError({ reason: 'intent_in_flight', message: error.message });
        }
        throw error;
      }`;
    expect(rethrowsPendingErrorRaw(rethrown)).toBe(true);
    // The trailing `throw error` outside the branch must not count: that path is a genuinely
    // unknown failure and is deliberately left alone.
    expect(rethrowsPendingErrorRaw(translated)).toBe(false);

    const withoutHeaders = `
      const r = router({
        submit: publicProcedure
          .meta({ openapi: { method: 'POST', path: '/x' } })
          .mutation(async () => { await runRelayedIntent({ operation: 'x' }); }),
      });`;
    const withHeaders = withoutHeaders.replace(
      "openapi: { method",
      'openapi: { requestHeaders: RELAYED_WRITE_REQUEST_HEADERS, method'
    );
    const unrelated = `
      const r = router({
        read: publicProcedure
          .meta({ openapi: { method: 'GET', path: '/x' } })
          .query(async () => ({})),
      });`;
    expect(relayedProcedureHeaderDeclarations(withoutHeaders)[0].declaresHeaders).toBe(false);
    expect(relayedProcedureHeaderDeclarations(withHeaders)[0].declaresHeaders).toBe(true);
    expect(relayedProcedureHeaderDeclarations(unrelated)).toEqual([]);
  });
});
