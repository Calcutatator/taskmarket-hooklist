// Verifies: ADR-0050
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const VOCABULARY_PATH = 'services/intents/evaluations-intents.ts';

const FAILURE_EXPLANATION = [
  'A verdict must be turned into its on-chain code by `verdictCode`, never by indexing',
  '`VERDICT_MAP` directly. The direct lookup returns `undefined` for anything outside the',
  'vocabulary, and every call site that has ever done it paired the lookup with `?? 0` --',
  'which is APPROVE, the outcome that pays the awards out. A verdict nobody can interpret',
  'must stop the call, not resolve into the most generous of the three. `verdictCode` raises',
  'a DeterministicRelayError, so the request path fails and the broadcast path reaches a',
  'terminal state instead of retrying a payload that can never succeed.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Every `VERDICT_MAP[...]` element access in a file, by line number. */
export function verdictMapLookups(source: string, filename = 'source.ts'): number[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'VERDICT_MAP'
    ) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines;
}

describe('the verdict vocabulary has one reader', () => {
  it('is indexed nowhere but inside verdictCode', () => {
    const offenders = sourceFiles(SRC_ROOT).flatMap((path) => {
      const relativePath = relative(SRC_ROOT, path).split('\\').join('/');
      if (relativePath === VOCABULARY_PATH) return [];
      return verdictMapLookups(readFileSync(path, 'utf8'), relativePath).map(
        (line) => `${relativePath}:${line}`
      );
    });

    expect(offenders, FAILURE_EXPLANATION).toEqual([]);
  });

  it('detects a reintroduced lookup', () => {
    // The detector itself, so a refactor that quietly stops matching anything is visible.
    expect(verdictMapLookups('const code = VERDICT_MAP[input.verdict] ?? 0;')).toEqual([1]);
  });
});
