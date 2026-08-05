// Verifies: ADR-0060
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * `evaluations.finalizeVerdict` records `rejected: task.verdictType === 'REJECT'` in its intent
 * payload. That is a database read, not a caller input, and ADR-0060 names exactly this shape as
 * its residual risk: the broadcaster-purity guard passes a field the router derived from state,
 * because purity is about what the broadcaster reads and says nothing about how the payload was
 * built. Whether the value is safe depends entirely on whether it can move between the request
 * and a rebroadcast hours later.
 *
 * It cannot, and the reason is narrower than the router's own `status === 'appealing'` guard.
 * `completeEvaluationsEvaluate` writes `verdictType` guarded to a status set that *includes*
 * 'appealing', so a write can and does land inside the window. What makes the value immovable is
 * that a task has at most one verdict: `EvaluatorFacet.evaluate` is callable only from
 * Review/Open/PendingApproval and leaves the task Appealing, so a second evaluation reverts and
 * exactly one TaskEvaluated is emitted for a task's whole life. Both writers below derive from
 * that one evaluation, so a late write rewrites the column with the value it already held.
 *
 * That argument is only as good as the writer set it quantifies over, and the writer set is the
 * part a future change moves. This test pins it: a third writer of `tasks.verdictType` -- or a
 * change of status guard on an existing one -- fails here, which is the prompt to re-examine the
 * payload rather than discover the drift on a rebroadcast nobody is watching.
 *
 * What this does NOT check: that the two known writers still agree on the value. That is a
 * property of the chain (one evaluation per task) and of the enum mapping they share, not
 * something a parser can settle -- exactly the review responsibility ADR-0060 leaves open.
 */
const EXPECTED_WRITERS = [
  'services/indexer.ts',
  'services/intents/evaluations-intents.ts',
] as const;

const EXPLANATION = [
  'A new writer of `tasks.verdictType` invalidates the safety argument for the',
  '`rejected` field in the `evaluations.finalizeVerdict` intent payload, which records the',
  'column at request time and replays it verbatim on every rebroadcast (ADR-0060). That field',
  'is safe only because every writer derives from the single on-chain evaluation a task can',
  'ever have, so they all write the same value. Before adding a writer, establish that it',
  'still holds -- and if it does not, the payload must stop carrying a state-derived value.',
  'See the comment at the payload site in `routers/evaluations.router.ts`.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Every `.set({ ... verdictType: ... })` in a source file.
 *
 * Matched on the drizzle `.set()` shape rather than on any mention of the name, because reads
 * of `verdictType` are everywhere (routers project it into responses) and only assignments can
 * move the column. An object literal reached some other way -- spread into `.set()`, built in a
 * helper -- would be missed; that is accepted, because no writer in this codebase is written
 * that way and a guard that tried to follow arbitrary indirection would be the heuristic
 * ADR-0060 argues against.
 */
export function verdictTypeWriteLines(source: string, filename = 'source.ts'): number[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'set' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        const name = property.name;
        if (name && ts.isIdentifier(name) && name.text === 'verdictType') {
          lines.push(sourceFile.getLineAndCharacterOfPosition(property.getStart()).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines;
}

describe('tasks.verdictType writers', () => {
  it('are only the two handlers for the single on-chain evaluation', () => {
    const writers = sourceFiles(SRC_ROOT)
      .flatMap((file) => {
        const rel = relative(SRC_ROOT, file).split('\\').join('/');
        return verdictTypeWriteLines(readFileSync(file, 'utf8'), rel).map(() => rel);
      })
      .filter((file, index, all) => all.indexOf(file) === index)
      .sort();

    expect(writers, EXPLANATION).toEqual([...EXPECTED_WRITERS].sort());
  });

  it('both write under a status guard that keeps a late write from inventing a verdict', () => {
    // Neither may write unconditionally. The indexer's handler is guarded to the states
    // `evaluate()` is callable from; the completion handler adds 'appealing' so an
    // indexer-first row does not cost it the fields the event cannot carry. Both guards
    // exclude every terminal state, so a verdict cannot appear on a task that has already
    // settled -- which is the other way the finalizeVerdict payload could go stale.
    for (const file of EXPECTED_WRITERS) {
      const source = readFileSync(join(SRC_ROOT, file), 'utf8');
      const guardedStatuses = /inArray\(tasks\.status, (\[[^\]]*\]|EVALUATABLE_STATUSES)\)/.test(
        source
      );
      expect(guardedStatuses, `${file} must guard its verdictType write by task status`).toBe(true);
    }
  });

  it('detects a write the guard exists to catch', () => {
    const added = `
      await db.update(tasks).set({ status: 'open', verdictType: 'APPROVE' }).where(x);
    `;
    expect(verdictTypeWriteLines(added, 'services/somewhere-new.ts')).toHaveLength(1);
  });

  it('does not count a read of the column as a write', () => {
    const read = `
      const rejected = task.verdictType === 'REJECT';
      const projection = { verdictType: tasks.verdictType };
    `;
    expect(verdictTypeWriteLines(read, 'routers/reads.ts')).toHaveLength(0);
  });
});
