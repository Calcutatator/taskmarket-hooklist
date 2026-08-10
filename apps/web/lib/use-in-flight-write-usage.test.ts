// Verifies: ADR-0049, ADR-0052
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Structural guard over the idempotency key, in the same shape as the backend's
 * `test/unit/config/` assertions: a rule the type system cannot express, checked against the
 * source rather than against behaviour, so it fails at build time rather than as a second
 * payment in production.
 *
 * The rule it enforces is the one `useInFlightWrite` exists to own. The hook mints the key,
 * hands it to the submission it was given, watches the outcome, and decides whether the key
 * survives -- held while the answer is unknown, retired once it is settled. That decision is
 * only sound if the key is never visible anywhere else. A component that reads the key off the
 * hook and passes it to a transport itself makes the hook's judgement advisory: it can send
 * under a key the hook has already retired, or keep presenting one the hook considers spent.
 *
 * That is not hypothetical. The shape before this one exposed `idempotencyKey` and trusted each
 * caller to report the outcome back through `capture`; ten of the sixteen surfaces sent a
 * corrected retry -- a different reward, a different worker, a different artifact set -- under
 * the failed attempt's key, and nothing anywhere failed. The migration is worth little without
 * something that stops the next call site reintroducing it, because the offending code looked
 * exactly like the code that was correct.
 */

const WEB_ROOT = join(import.meta.dirname, '..');

/**
 * Product source only. Tests and stories are excluded deliberately: both legitimately reach
 * past the hook to assert on or fake a key -- `assign-evaluator-action.test.tsx` reads the key
 * out of a transport mock precisely to prove rotation happens -- and a rule that forbade it
 * would make the regression tests for this defect unwritable.
 */
const SCANNED_ROOTS = ['components', 'app'];

/** How a component may name the key: as the parameter `submit` hands it, and nowhere else. */
const KEY_PROPERTY = 'idempotencyKey';

/**
 * The property the in-flight state hangs off.
 *
 * `inFlight.state.idempotencyKey` is allowed where `inFlight.idempotencyKey` is not, and the
 * difference is not cosmetic. `state` is null until a write has actually gone in flight, so a
 * key read through it names a write that is already outstanding -- the one case where the key
 * is settled fact rather than a fresh mint, and the only case the notice is rendered in.
 * Every surface refuses to submit again while `state` is non-null, so a key reached this way
 * cannot become the key of a second, different write. Reading it inside a `submit` callback is
 * still refused below, since that is the one context where it could.
 */
const IN_FLIGHT_STATE_PROPERTY = 'state';

/**
 * Transports that accept a key. Named explicitly rather than inferred, because a list guessed
 * from a naming convention produces false positives, and a structural assertion that cries
 * wolf gets deleted rather than fixed. Add to it when a new transport learns to take a key.
 */
const KEYED_TRANSPORTS = new Set(['payX402Post', 'signAndPost']);

/** The header a hand-rolled fetch sets, which is that fetch passing a key to the backend. */
const KEY_HEADER_CONSTANT = 'IDEMPOTENCY_KEY_HEADER';

const READ_EXPLANATION = [
  'A component must never read the idempotency key off useInFlightWrite. The hook decides when',
  'a key is spent -- held on a pending or ambiguous outcome, retired on a terminal one -- and a',
  'component that holds the key can send under one the hook has already retired, or present one',
  'it considers spent. Pass the submission instead: inFlight.submit((idempotencyKey) => ...),',
  'and use only the parameter the hook hands you. See apps/web/lib/use-in-flight-write.ts.',
].join(' ');

const TRANSPORT_EXPLANATION = [
  'A transport call that carries an idempotency key must sit inside the callback passed to',
  'inFlight.submit(...), so the hook sees the outcome it is deciding on. A keyed call outside',
  'that callback is a write the hook never learns about, which leaves the key to rotate on a',
  'result nobody reported, or not to rotate on one it should have. Wrap the call:',
  'const outcome = await inFlight.submit((idempotencyKey) => payX402Post(..., idempotencyKey));',
  'if (outcome.handled) return;',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    if (!entry.isFile()) return [];
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec|stories)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function parse(source: string, filename: string): ts.SourceFile {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** True when `node` sits inside a function argument of some `<something>.submit(...)` call. */
function insideSubmitCallback(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    const callback = current;
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) continue;
    const call = callback.parent;
    if (!call || !ts.isCallExpression(call)) continue;
    if (!call.arguments.includes(callback as ts.Expression)) continue;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'submit') return true;
  }
  return false;
}

/**
 * Every `<expression>.idempotencyKey` read in the file.
 *
 * Matched on the property name rather than on the object, because the object is exactly what a
 * rename hides: `inFlight.idempotencyKey`, a destructured `const { idempotencyKey } = inFlight`,
 * and a `writeState.idempotencyKey` are the same mistake wearing three names. A shorthand
 * property in an object literal (`{ idempotencyKey }` forwarding the callback's own parameter)
 * is not a read off the hook and is left alone.
 */
export function keyReads(source: string, filename = 'source.tsx'): string[] {
  const sourceFile = parse(source, filename);
  const found: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === KEY_PROPERTY) {
      const throughInFlightState =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === IN_FLIGHT_STATE_PROPERTY;
      // Allowed only outside a submission: see IN_FLIGHT_STATE_PROPERTY.
      if (!throughInFlightState || insideSubmitCallback(node)) {
        found.push(node.getText(sourceFile));
      }
    }
    // Only a destructure of a *value* -- `const { idempotencyKey } = inFlight`. A destructure
    // in a parameter position is a component reading its own props, which is how the key
    // reaches `InFlightWriteNotice` and the local wrappers that forward it there: display, not
    // dispatch, and a rule that forbade it would forbid printing the key at all.
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      (node.propertyName && ts.isIdentifier(node.propertyName)
        ? node.propertyName.text
        : ts.isIdentifier(node.name) && node.name.text) === KEY_PROPERTY
    ) {
      found.push(node.parent.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Every call that hands a key to a transport from outside a `submit` callback.
 *
 * A keyed call is one of the named transports invoked with a key -- `payX402Post`'s fifth
 * argument, or an `idempotencyKey` property in `signAndPost`'s options -- or a fetch whose
 * headers mention the key header. Deliberately narrow on the "with a key" part:
 * `agent-identity-card.tsx` calls `payX402Post` with four arguments and no key at all, which is
 * a genuine unkeyed write and not this rule's business. Flagging every transport call instead
 * of every keyed one would fail on it, and a guard that has to be argued with is a guard that
 * gets switched off.
 */
export function unwrappedKeyedTransportCalls(source: string, filename = 'source.tsx'): string[] {
  const sourceFile = parse(source, filename);
  const found: string[] = [];

  function carriesKey(call: ts.CallExpression): boolean {
    const callee = ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : ts.isIdentifier(call.expression)
        ? call.expression.text
        : '';
    if (!KEYED_TRANSPORTS.has(callee)) return false;
    // Positional form: `payX402Post(path, body, deps, setStep, key)`.
    if (call.arguments.length >= 5) return true;
    // Options form: `signAndPost({ idempotencyKey, ... })`.
    return call.arguments.some(
      (argument) =>
        ts.isObjectLiteralExpression(argument) &&
        argument.properties.some(
          (property) =>
            property.name && ts.isIdentifier(property.name) && property.name.text === KEY_PROPERTY
        )
    );
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && carriesKey(node) && !insideSubmitCallback(node)) {
      found.push(node.expression.getText(sourceFile));
    }
    // A hand-rolled fetch passes the key by setting the header itself.
    if (
      ts.isIdentifier(node) &&
      node.text === KEY_HEADER_CONSTANT &&
      !ts.isImportSpecifier(node.parent) &&
      !insideSubmitCallback(node)
    ) {
      found.push(KEY_HEADER_CONSTANT);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function offenders(check: (source: string, filename: string) => string[]): string[] {
  return SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_ROOT, root)))
    .flatMap((path) => {
      const relativePath = relative(WEB_ROOT, path).split(sep).join('/');
      return check(readFileSync(path, 'utf8'), path).map((hit) => `${relativePath}: ${hit}`);
    })
    .sort();
}

describe('who may hold an idempotency key', () => {
  it('keeps the key out of every component', () => {
    expect(offenders(keyReads), READ_EXPLANATION).toEqual([]);
  });

  it('keeps a keyed transport call inside the submit callback that owns its key', () => {
    expect(offenders(unwrappedKeyedTransportCalls), TRANSPORT_EXPLANATION).toEqual([]);
  });

  it('sees a key read however the component names it', () => {
    expect(keyReads(`const key = inFlight.idempotencyKey;`)).toHaveLength(1);
    expect(keyReads(`const { idempotencyKey } = useInFlightWrite('x');`)).toHaveLength(1);
    expect(keyReads(`const { idempotencyKey: k } = inFlight;`)).toHaveLength(1);
    // A component receiving the key as a prop to render is not reading it off the hook.
    expect(
      keyReads(`function Notice({ idempotencyKey }: Props) { return <p>{idempotencyKey}</p>; }`)
    ).toEqual([]);
    expect(keyReads(`payX402Post(p, b, d, s, writeState.idempotencyKey);`)).toHaveLength(1);

    // The legitimate shape: the callback's own parameter, forwarded by shorthand.
    expect(
      keyReads(`inFlight.submit((idempotencyKey) => signAndPost({ idempotencyKey, path }));`)
    ).toEqual([]);
  });

  it('allows the in-flight state to be displayed but not resubmitted', () => {
    // What every consumer does: hand the outstanding write's key to the notice to print.
    expect(
      keyReads(`<InFlightWriteNotice idempotencyKey={inFlight.state.idempotencyKey} />`)
    ).toEqual([]);

    // The one context where that same read would be a second write under an outstanding key.
    expect(
      keyReads(`inFlight.submit(() => payX402Post(p, b, d, s, inFlight.state.idempotencyKey));`)
    ).toHaveLength(1);
  });

  it('distinguishes a wrapped keyed call from a bare one', () => {
    const wrapped = `
      const outcome = await inFlight.submit((idempotencyKey) =>
        payX402Post(path, body, deps, setStep, idempotencyKey)
      );
    `;
    expect(unwrappedKeyedTransportCalls(wrapped)).toEqual([]);

    const bare = `const result = await payX402Post(path, body, deps, setStep, someKey);`;
    expect(unwrappedKeyedTransportCalls(bare)).toEqual(['payX402Post']);

    const bareOptions = `const result = await signAndPost({ idempotencyKey: someKey, path });`;
    expect(unwrappedKeyedTransportCalls(bareOptions)).toEqual(['signAndPost']);

    // An unkeyed transport call is a different thing and stays allowed.
    expect(unwrappedKeyedTransportCalls(`payX402Post(path, body, deps, setStep);`)).toEqual([]);
  });

  it('sees a hand-rolled fetch setting the key header outside a submit callback', () => {
    const bare = `
      import { IDEMPOTENCY_KEY_HEADER } from '@/lib/api/idempotency';
      await fetch(url, { headers: { [IDEMPOTENCY_KEY_HEADER]: key }, method: 'POST' });
    `;
    expect(unwrappedKeyedTransportCalls(bare)).toEqual([KEY_HEADER_CONSTANT]);

    const wrapped = `
      import { IDEMPOTENCY_KEY_HEADER } from '@/lib/api/idempotency';
      await inFlight.submit(async (idempotencyKey) =>
        fetch(url, { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }, method: 'POST' })
      );
    `;
    expect(unwrappedKeyedTransportCalls(wrapped)).toEqual([]);
  });
});
