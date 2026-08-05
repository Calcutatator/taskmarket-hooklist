// Verifies: ADR-0052, ADR-0058
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * A report's idempotency key comes from the outcome being reported, never from context.
 *
 * A write returns its key beside the payload and attaches it to whatever it raises, so a command
 * reporting a success has the key in hand and a renderer reporting a failure reads it off the
 * error. Neither has to work out *which* write is in question, because the value they hold came
 * from that write.
 *
 * The CLI used to answer that question from ambient state instead -- an `AsyncLocalStorage` scope
 * holding "the last write started here". That is only the write being reported while exactly one
 * write is in play, so a batch that stashed a failure and kept going, and a poll loop that wrote
 * once a turn, both reported a real key naming the wrong operation. Nothing downstream can catch
 * that: the envelope is well formed, the key resolves, and it resolves to somebody else's write.
 *
 * These checks fail the build if that mechanism comes back. They are structural because the
 * mistake is not a wrong value anywhere -- it is a value being *derived from when the code runs*,
 * which no assertion about a single run can distinguish from the right answer.
 */
const AMBIENT_MACHINERY = ['AsyncLocalStorage', 'getCurrentIdempotencyKey'];

const AMBIENT_EXPLANATION = [
  'The idempotency key a report carries must come from the outcome it is reporting -- returned by',
  'the write on success, read off the error on failure -- never from ambient state such as',
  'AsyncLocalStorage. "The last write started here" is only the write being reported while exactly',
  'one write is in play, which is not the shape of a batch, a poll loop, or anything that writes',
  'and then keeps working. A key naming the wrong write is worse than none: it is the handle an',
  'operator re-presents, so it matches a different intent, returns its result, and reports the',
  'operation they wanted as done when it never ran.',
].join(' ');

const RETURN_EXPLANATION = [
  'Every write in lib/ must return its idempotency key alongside the payload (WriteOutcome), so a',
  'command reporting success has the key of the write it is reporting rather than having to find',
  'it somewhere. A write that returns only a body forces the caller back to guessing.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Every use of the ambient machinery as *code*, by name.
 *
 * Identifiers rather than text, so that the comment in `lib/idempotency.ts` explaining why the
 * `AsyncLocalStorage` scope was removed does not read as the thing it warns against. Recording
 * why a mechanism went away is exactly what should stay written down.
 */
export function ambientKeyUses(source: string, filename = 'source.ts'): string[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && AMBIENT_MACHINERY.includes(node.text)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return [...found].sort();
}

/** Every exported async function whose declared return type is not a `WriteOutcome`, by name. */
export function writesNotReturningTheirKey(source: string, filename = 'source.ts'): string[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported !== true) continue;
    // A write is a function that sends the key as a header. Reads never call this.
    const body = statement.body?.getText(sourceFile) ?? '';
    if (!body.includes('idempotencyHeaders(')) continue;
    const returnType = statement.type?.getText(sourceFile) ?? '';
    if (!returnType.includes('WriteOutcome')) offenders.push(statement.name.text);
  }

  return offenders;
}

describe('where the key on a report comes from', () => {
  it('has no ambient key machinery anywhere in the CLI', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .map((path) => relative(SRC_ROOT, path))
      .flatMap((relativePath) =>
        ambientKeyUses(readFileSync(join(SRC_ROOT, relativePath), 'utf8'), relativePath).map(
          (name) => `${relativePath}: ${name}`
        )
      )
      .sort();

    expect(offenders, AMBIENT_EXPLANATION).toEqual([]);
  });

  it('returns the key from every write in the transport', () => {
    const offenders = ['lib/api.ts', 'lib/x402.ts']
      .flatMap((relativePath) =>
        writesNotReturningTheirKey(
          readFileSync(join(SRC_ROOT, relativePath), 'utf8'),
          relativePath
        ).map((name) => `${relativePath}: ${name}`)
      )
      .sort();

    expect(offenders, RETURN_EXPLANATION).toEqual([]);
  });

  it('finds ambient machinery in code but not in the comment explaining its removal', () => {
    const scope = `
      const storage = new AsyncLocalStorage<Scope>();
      export function withIdempotencyScope<T>(fn: () => Promise<T>) {
        return storage.run({}, fn);
      }`;
    const read = `const key = getCurrentIdempotencyKey();`;
    // The comment in lib/idempotency.ts, in miniature. It must stay legal.
    const explanation = `
      // There was an ambient key once, bound with AsyncLocalStorage and read by
      // getCurrentIdempotencyKey. It could name the wrong write, so it is gone.
      export const nothing = 1;`;

    expect(ambientKeyUses(scope)).toEqual(['AsyncLocalStorage']);
    expect(ambientKeyUses(read)).toEqual(['getCurrentIdempotencyKey']);
    expect(ambientKeyUses(explanation)).toEqual([]);
  });

  it('finds a write that keeps its key to itself, rather than matching on text', () => {
    // The detector, exercised against sources shaped like the mistake it exists to catch. A guard
    // nobody has seen fail is a guard nobody knows works.
    const keeps = `
      export async function apiPost(path: string): Promise<unknown> {
        return withIdempotentWrite(key, async () => {
          await fetch(path, { headers: { ...idempotencyHeaders(key) } });
        });
      }`;
    const returns = `
      export async function apiPost(path: string): Promise<WriteOutcome<T>> {
        return withIdempotentWrite(key, async () => {
          await fetch(path, { headers: { ...idempotencyHeaders(key) } });
        });
      }`;
    // A read sends no key and owes none back, so it is not a write and not an offender.
    const read = `
      export async function apiGet(path: string): Promise<unknown> {
        return fetch(path);
      }`;

    expect(writesNotReturningTheirKey(keeps)).toEqual(['apiPost']);
    expect(writesNotReturningTheirKey(returns)).toEqual([]);
    expect(writesNotReturningTheirKey(read)).toEqual([]);
  });
});
