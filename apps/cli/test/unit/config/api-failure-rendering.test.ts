// Verifies: ADR-0058
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * The one place a failure is allowed to be turned into the CLI's JSON envelope.
 *
 * ADR-0058 gave every API error a machine-readable `reason`, and the CLI turns it into the
 * `pending` field a script branches on: true means the write may still succeed, so re-running it
 * is a second payment rather than a retry. That only holds if every failure travels through the
 * renderer that knows how to read the envelope. A command that catches its own error and prints
 * `err.message` has thrown the envelope away, and it does so silently -- the output still looks
 * like a well-formed failure, it just answers a question it no longer has the evidence for.
 */
const RENDERER = 'lib/output.ts';

const PRINT_ERROR_IN_CATCH_EXPLANATION = [
  '`printError` takes a message the caller composed itself and has no error to read an envelope',
  "from, so calling it on a caught value discards the backend's classification (ADR-0058) --",
  'the `reason`, the intent id, and the `pending` flag a script needs to tell a write that is',
  'still landing from one that was rejected. Inside a `catch`, call `renderFailure(err)` instead:',
  'it renders an `ApiError` with its envelope and a locally thrown `Error` exactly as',
  '`printError` did. Reserve `printError` for messages with no error behind them.',
].join(' ');

const SINGLE_RENDERER_EXPLANATION = [
  "Only lib/output.ts may build the CLI's `ok: false` failure envelope. A second renderer is how",
  'the field set drifts: whichever one nobody remembers to update stops emitting `pending`, and a',
  'script reading it cannot tell that the answer is missing rather than false.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Every `printError(...)` call inside a `catch` block that binds the error it caught, by line.
 *
 * The binding is what makes the call a discard. A `catch (err)` had the failure in hand and chose
 * to render something else, so whatever envelope arrived with it is gone. A bare `catch {}` never
 * held one: the only thing it can print is a constant the author wrote, which does not purport to
 * describe an API failure at all and so has nothing to lose. Scoping the rule to the binding is
 * why it has no false positives on the local `Cannot read file` and `No keystore found` messages,
 * which are correct exactly as they are.
 */
export function printErrorInCatchSites(source: string, filename = 'source.ts'): number[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function scanForPrintError(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'printError'
    ) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, scanForPrintError);
  }

  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      scanForPrintError(node.block);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines.sort((a, b) => a - b);
}

describe('how the CLI renders an API failure', () => {
  it('renders no caught error through printError', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .flatMap((path) => {
        const relativePath = relative(SRC_ROOT, path);
        return printErrorInCatchSites(readFileSync(path, 'utf8'), relativePath).map(
          (line) => `${relativePath}:${line}`
        );
      })
      .sort();

    expect(offenders, PRINT_ERROR_IN_CATCH_EXPLANATION).toEqual([]);
  });

  it('builds the failure envelope in exactly one file', () => {
    const builders = sourceFiles(SRC_ROOT)
      .map((path) => relative(SRC_ROOT, path))
      .filter(
        (relativePath) =>
          relativePath !== RENDERER &&
          readFileSync(join(SRC_ROOT, relativePath), 'utf8').includes('ok: false')
      )
      .sort();

    expect(builders, SINGLE_RENDERER_EXPLANATION).toEqual([]);
  });

  it('reads pending off the envelope where the envelope is read, and nowhere else', () => {
    // `pending` is the field the guidance in docs/CLI_GUIDE.md tells scripts to branch on, so it
    // must be computed from `isInFlightApiError` rather than inferred from a status or a message.
    const renderer = readFileSync(join(SRC_ROOT, RENDERER), 'utf8');
    expect(renderer).toContain('isInFlightApiError');
    expect(renderer).toContain('pending');
  });

  it('finds a caught error rendered through printError, rather than matching on text', () => {
    // The detector, exercised against sources shaped like the mistake it exists to catch. A guard
    // nobody has seen fail is a guard nobody knows works.
    const discarded = `
      try { await x402Post(p, b); } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }`;
    const preserved = `
      try { await x402Post(p, b); } catch (err) {
        renderFailure(err);
      }`;
    // A message with no error behind it is the case printError is for, and stays legal.
    const local = `if (opts.verdict !== 'approve') printError('--verdict must be "approve"');`;
    // So does an unbound catch: it never held an envelope, so it discards nothing.
    const unbound = `
      try { await fs.readFile(f); } catch {
        printError(\`Cannot read file: \${f}\`);
      }`;

    expect(printErrorInCatchSites(discarded)).toEqual([3]);
    expect(printErrorInCatchSites(preserved)).toEqual([]);
    expect(printErrorInCatchSites(local)).toEqual([]);
    expect(printErrorInCatchSites(unbound)).toEqual([]);
  });
});
