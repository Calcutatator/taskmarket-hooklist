// Verifies: ADR-0050
// Verifies: ADR-0060
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const REGISTER_PATH = join(SRC_ROOT, 'services', 'intents', 'register.ts');

/**
 * A broadcaster is the replay path, so it must be a pure function of what was recorded.
 *
 * ADR-0050 point 7 fixes everything about a relayed write except gas, and says a payload is
 * replayed verbatim. Its corollary is the part this test enforces: a payload that would be
 * actively wrong on replay is carrying the wrong thing. A broadcaster that re-derives an
 * argument at send time -- from the database, from a fresh chain read, from the clock -- is
 * exactly that defect, because the value it derives hours later is not the value the payer
 * authorised.
 *
 * Five instances of it reached review on this branch and were caught only by a human reading
 * carefully: `acceptance.accept` re-resolving a deliverable hash (on a bounty, a *different
 * worker's* submission), `evaluations.resolveDispute` storing a projection of a verdict rather
 * than the verdict, `tasks.update` re-reading the reward that sizes the forwarder's transfer,
 * `tasks.create` predicting a task id from a nonce, and several payloads missing a sender or a
 * contract address. Review is the wrong mechanism for a rule this consequential.
 *
 * The rule checked here is the strongest one that is mechanically decidable: **the transitive
 * call graph rooted at each registered `broadcast` reads nothing but its own arguments.** It is
 * decidable because that graph is closed -- a broadcaster reaches the outside world only
 * through a call, and every call either resolves to a function this test follows or to a
 * terminal module on the allowlist below. Anything it cannot resolve is a finding, not a pass,
 * so the closure holds for code nobody has written yet.
 *
 * What it deliberately does NOT check, because neither is decidable from the AST:
 *
 *   - Whether a *completion handler* reads mutable database state to derive a value it writes.
 *     A completion handler legitimately reads the database (`completeEvaluationsEvaluate`
 *     selects the task for its appeal window) and legitimately reads the chain keyed on the
 *     confirmed hash (`blockNumberForTx`). Telling a stable tx-keyed read from a mutable
 *     state-keyed one needs to know what the value means, not what shape it has.
 *   - Whether a payload *field* was derived, back in the router, from a database row that a
 *     first attempt could have moved. That derivation happens in the request, which is allowed
 *     to read anything, and no syntax distinguishes "read a column and recorded it" from "read
 *     a column a confirmed first attempt already changed".
 *
 * Both remain review's job. This test takes the half that is not, and it is the load-bearing
 * half: a payload can only be insufficient if something downstream compensates by reading
 * around it, and a broadcaster is the only thing downstream of the payload that could.
 */
const EXPLANATION = [
  'A registered broadcaster must be reconstructible from its intent row alone: the persisted',
  'payload plus the envelope fields that never move. Reading the database, the clock, a random',
  'source, or the chain at broadcast time means the transaction replayed is not the transaction',
  'the payer authorised -- ADR-0050 point 7. If a broadcaster needs a value it does not have,',
  'record that value in the payload at request time; do not re-derive it here.',
  'See docs/adr/0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md.',
].join(' ');

/**
 * Intent-row fields a broadcaster may read.
 *
 * All of them are written once, before the chain call, and never rewritten -- which is the
 * property that makes them safe to replay from. `payload` is the recorded call, `payer` the
 * identity the router established before recording, `paymentTxHash` the settled x402 reference
 * (ADR-0057), fixed by the time the intent exists at all.
 *
 * Notably absent: `txHash`, `broadcastAttempts`, `status`, `completionAttempts`, `lastError`.
 * Every one of those moves between attempts, so a broadcaster reading any of them would send a
 * different transaction on a rebroadcast than it sent the first time.
 */
const REPLAYABLE_INTENT_FIELDS = new Set([
  'createdAt',
  'id',
  'operation',
  'payer',
  'paymentTxHash',
  'payload',
]);

/**
 * Modules a broadcaster may call into without this test following the call.
 *
 * `services/contract` is the chain-write layer; following it would mean following viem into the
 * RPC client, and ending in one of those calls is the entire purpose of a broadcaster. `viem`
 * is pure encoding. Terminal is not the same as unconditionally allowed -- BLOCKED_NAMES below
 * still bans the reads `services/contract` exports that are keyed on live chain state rather
 * than on the call being built.
 */
const TERMINAL_PACKAGES = new Set(['viem']);
const TERMINAL_LOCAL_MODULES = new Set([join(SRC_ROOT, 'services', 'contract')]);

/**
 * Any reference to one of these names inside the broadcast call graph is a violation.
 *
 * Three groups, all for one reason -- each is a value that can differ between the request and a
 * rebroadcast hours later:
 *
 *   - the database handle, under every name it travels;
 *   - the clock, and every source of freshness;
 *   - the chain reads exported from `services/contract`. Those are legitimate in a *completion*
 *     handler, where they are keyed on a confirmed transaction hash and so return the same
 *     answer forever. In a broadcaster there is no confirmed hash yet, so the only thing they
 *     could be keyed on is live state.
 */
const BLOCKED_NAMES = new Map<string, string>([
  ['blockNumberForTx', 'reads the chain; a broadcaster has no confirmed transaction to key on'],
  ['blockTimestampForTx', 'reads the chain; a broadcaster has no confirmed transaction to key on'],
  ['contractGetTask', 'reads live task state, which a first attempt may already have changed'],
  [
    'contractProjectSettlementForTx',
    'reads the chain; a broadcaster has no confirmed transaction to key on',
  ],
  ['crypto', 'a fresh random value differs between attempts'],
  ['Date', 'the clock differs between attempts; carry the request-time value in the payload'],
  ['db', 'the database can move between the request and a rebroadcast'],
  ['getDb', 'the database can move between the request and a rebroadcast'],
  ['getPublicClient', 'a fresh chain read can differ between attempts'],
  ['nanoid', 'a fresh random value differs between attempts'],
  ['randomUUID', 'a fresh random value differs between attempts'],
  ['readContract', 'a fresh chain read can differ between attempts'],
  ['taskIdForTx', 'reads the chain; a broadcaster has no confirmed transaction to key on'],
]);

/** Globals a broadcaster may call. All pure; `Math.random` is rejected separately. */
const PURE_GLOBALS = new Set([
  'Array',
  'BigInt',
  'Boolean',
  'Error',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Set',
  'String',
  'Symbol',
]);

type Finding = { detail: string; location: string };

const sourceCache = new Map<string, ts.SourceFile>();

function sourceFor(path: string): ts.SourceFile {
  const cached = sourceCache.get(path);
  if (cached) return cached;
  const parsed = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  sourceCache.set(path, parsed);
  return parsed;
}

function locate(sourceFile: ts.SourceFile, node: ts.Node): string {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return `${relative(SRC_ROOT, sourceFile.fileName)}:${line}`;
}

/** Every value `import` binding in a file, mapped from local name to the module it came from. */
function importsOf(sourceFile: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    // A type-only import cannot carry a value into the call graph, and excluding it is not just
    // an optimisation: every intents file type-imports the db client for its completion
    // handlers' signatures, which must not be read as the broadcaster reaching the database.
    if (statement.importClause?.isTypeOnly) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        bindings.set(element.name.text, statement.moduleSpecifier.text);
      }
    }
    if (statement.importClause?.name) {
      bindings.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
  }
  return bindings;
}

/** Top-level functions and arrow-valued consts declared in this file, by name. */
function declarationsOf(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return declarations;
}

function resolveModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isTerminalModule(fromFile: string, specifier: string): boolean {
  if (TERMINAL_PACKAGES.has(specifier)) return true;
  if (!specifier.startsWith('.')) return false;
  return TERMINAL_LOCAL_MODULES.has(resolve(dirname(fromFile), specifier));
}

/** True when this identifier is a property *name* (`x.payload`), not a reference to a binding. */
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return false;
}

/**
 * Walk the call graph rooted at one function and collect everything impure it can reach.
 *
 * `seen` is keyed on file plus position, so mutual recursion terminates and a helper two
 * broadcasters share is reported at most once per root.
 */
function auditFunction(input: {
  findings: Finding[];
  node: ts.Node;
  seen: Set<string>;
  sourceFile: ts.SourceFile;
}): void {
  const { findings, sourceFile } = input;
  const key = `${sourceFile.fileName}#${input.node.getStart()}`;
  if (input.seen.has(key)) return;
  input.seen.add(key);

  const imports = importsOf(sourceFile);
  const declarations = declarationsOf(sourceFile);

  function follow(name: string, at: ts.Node): void {
    const specifier = imports.get(name);
    if (specifier) {
      if (isTerminalModule(sourceFile.fileName, specifier)) return;
      const resolved = resolveModule(sourceFile.fileName, specifier);
      if (!resolved) {
        // An unresolvable call is a finding rather than a pass. A broadcaster that reaches a
        // package this test cannot read is a broadcaster nobody can claim is replayable.
        findings.push({
          detail: `calls ${name}() from '${specifier}', which is neither a terminal module nor a file this test can follow`,
          location: locate(sourceFile, at),
        });
        return;
      }
      const target = sourceFor(resolved);
      const declaration = declarationsOf(target).get(name);
      if (!declaration) {
        findings.push({
          detail: `calls ${name}(), which is not a top-level declaration in ${relative(SRC_ROOT, resolved)}`,
          location: locate(sourceFile, at),
        });
        return;
      }
      auditFunction({ findings, node: declaration, seen: input.seen, sourceFile: target });
      return;
    }

    const local = declarations.get(name);
    if (local) {
      auditFunction({ findings, node: local, seen: input.seen, sourceFile });
      return;
    }

    if (PURE_GLOBALS.has(name)) return;

    findings.push({
      detail: `calls ${name}(), which resolves to neither an import nor a local declaration -- if it is a global, it is not one a replayable broadcaster may use`,
      location: locate(sourceFile, at),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && !isPropertyName(node)) {
      const reason = BLOCKED_NAMES.get(node.text);
      if (reason) {
        findings.push({
          detail: `references ${node.text} -- ${reason}`,
          location: locate(sourceFile, node),
        });
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      node.name.text === 'random'
    ) {
      findings.push({
        detail: 'references Math.random -- a fresh random value differs between attempts',
        location: locate(sourceFile, node),
      });
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      follow(node.expression.text, node);
    }

    ts.forEachChild(node, visit);
  }

  visit(input.node);
}

/** Every `broadcast:` property of a `registerRelayedIntentHandler` call, with its operation. */
function registeredBroadcasters(sourceFile: ts.SourceFile): { node: ts.Node; operation: string }[] {
  const found: { node: ts.Node; operation: string }[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'registerRelayedIntentHandler' &&
      node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      const operation = (node.arguments[0] as ts.StringLiteral).text;
      const handler = node.arguments[1]!;
      if (ts.isObjectLiteralExpression(handler)) {
        for (const property of handler.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'broadcast'
          ) {
            found.push({ node: property.initializer, operation });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Intent fields a broadcast handler touches, as `intent.<field>` property accesses. */
function intentFieldsRead(node: ts.Node): string[] {
  const fields: string[] = [];
  function visit(current: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'intent'
    ) {
      fields.push(current.name.text);
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return fields;
}

/** Names a broadcast handler's parameter destructuring binds out of the registry context. */
function contextBindings(node: ts.Node): string[] {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return [];
  const [parameter] = node.parameters;
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return [];
  return parameter.name.elements.flatMap((element) =>
    ts.isIdentifier(element.name) ? [(element.propertyName ?? element.name).getText()] : []
  );
}

describe('relayed intent broadcast purity', () => {
  const register = sourceFor(REGISTER_PATH);
  const broadcasters = registeredBroadcasters(register);

  it('finds the registrations it is meant to be checking', () => {
    // Guards the guard. A parse that quietly matched nothing would make every assertion below
    // vacuously true, which is the failure mode a structural test most needs to rule out.
    expect(broadcasters.length).toBeGreaterThan(20);
    expect(broadcasters.map((entry) => entry.operation)).toContain('acceptance.accept');
    expect(broadcasters.map((entry) => entry.operation)).toContain('tasks.create');
  });

  it('never hands a broadcaster the database', () => {
    // The registry passes `{ db, intent }`, because a broadcaster and a completion handler share
    // one context shape. Binding `db` here would open the whole database to the replay path in a
    // single character, so it is refused at the registration site rather than left to the
    // call-graph sweep below to catch whatever it was eventually used for.
    const offenders = broadcasters
      .filter((entry) => contextBindings(entry.node).includes('db'))
      .map((entry) => entry.operation)
      .sort();

    expect(offenders, EXPLANATION).toEqual([]);
  });

  it('reads only fields that never move off the intent row', () => {
    const permitted = [...REPLAYABLE_INTENT_FIELDS].sort().join(', ');
    const offenders = broadcasters
      .flatMap((entry) =>
        intentFieldsRead(entry.node)
          .filter((field) => !REPLAYABLE_INTENT_FIELDS.has(field))
          .map((field) => `${entry.operation} reads intent.${field}`)
      )
      .sort();

    expect(
      offenders,
      `${EXPLANATION} A broadcaster may read only ${permitted} -- every other column on the intent row moves between attempts.`
    ).toEqual([]);
  });

  it('reaches nothing impure through the whole broadcast call graph', () => {
    const offenders = broadcasters
      .flatMap((entry) => {
        const findings: Finding[] = [];
        auditFunction({ findings, node: entry.node, seen: new Set(), sourceFile: register });
        return findings.map(
          (finding) => `${entry.operation}: ${finding.location} ${finding.detail}`
        );
      })
      .sort();

    expect(offenders, EXPLANATION).toEqual([]);
  });
});
