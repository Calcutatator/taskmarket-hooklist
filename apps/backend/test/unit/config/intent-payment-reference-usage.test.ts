// Verifies: ADR-0048
// Verifies: ADR-0050
// Verifies: ADR-0057
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const MIDDLEWARE_PATH = 'middleware/x402.ts';
const REQUEST_PATH = 'services/relayed-intent-request.ts';

/**
 * A settled payment is one fact -- who paid, how much, in which transaction -- and settlement
 * can only refund a payment it can name in full. While that fact lived in three independently
 * optional fields on `runRelayedIntent`, a paid route could record a hash and no amount, and
 * did: a sandbox run found 83 of 174 paid intents with a null `paymentAmount`, across 20 of 22
 * paid operations, because only 2 of 26 call sites passed one. `settleAbandonedIntents` cannot
 * transfer an amount it does not have, so every one of those rows was skipped in silence.
 *
 * These assertions guard the shape rather than the symptom. The split fields are gone from the
 * input type, and the one remaining `payment` is built only by the middleware that settled it,
 * so neither a forgotten amount nor a re-derived wrong one is expressible.
 */
const SPLIT_PAYMENT_FIELDS = new Set(['paymentAmount', 'paymentTxHash']);

const SPLIT_FIELD_EXPLANATION = [
  'A relayed intent takes its payment as one `IntentPaymentReference`, not as separate',
  '`paymentTxHash` and `paymentAmount` fields. Independently optional fields are what let 24',
  'paid call sites record a payment hash with no amount, which settlement then skipped in',
  'silence -- the payer neither served nor refunded, and nothing reporting it. Build the',
  'reference with `settledPaymentReference(ctx.res)` instead of reintroducing the fields.',
].join(' ');

const HAND_BUILT_EXPLANATION = [
  'The payment amount on an intent must be the amount the x402 middleware settled, read back',
  'through `settledPaymentReference`. A refund is paid out of pooled escrow, so an amount a',
  'router re-derived from a pricing rule is worse than no amount at all when the two disagree:',
  'it returns somebody else another payer’s money. tasks.create and tasks.update are priced',
  'above the flat action fee and are exactly where a second copy of the rule drifts.',
].join(' ');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

type CallSite = {
  file: string;
  line: number;
  /** What the call passes as `payment`, if anything. */
  payment: ts.Expression | undefined;
  /** Any of the removed split fields the call still passes. */
  splitFields: string[];
};

/**
 * Every `runRelayedIntent({ ... })` call in a source, with whatever it passes as `payment`.
 *
 * Matched on the callee name rather than on the import, because unlike the orphaned-payment
 * guard next door there is nothing to alias around: this looks at what a known call passes,
 * not at whether a module was reached.
 */
export function relayedIntentCallSites(source: string, filename = 'source.ts'): CallSite[] {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const sites: CallSite[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'runRelayedIntent' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const literal = node.arguments[0];
      const named = new Map<string, ts.Expression>();
      for (const property of literal.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
          continue;
        }
        const name = property.name.getText(sourceFile);
        named.set(name, ts.isPropertyAssignment(property) ? property.initializer : property.name);
      }
      sites.push({
        file: filename,
        line: sourceFile.getLineAndCharacterOfPosition(literal.pos).line + 1,
        payment: named.get('payment'),
        splitFields: [...SPLIT_PAYMENT_FIELDS].filter((field) => named.has(field)).sort(),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sites;
}

/** True when a source names one of the split payment fields as an object property anywhere. */
export function usesSplitPaymentFields(source: string, filename = 'source.ts'): boolean {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertySignature(node)) &&
      node.name &&
      SPLIT_PAYMENT_FIELDS.has(node.name.getText(sourceFile))
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** The text of the expression a call site passes as `payment`, for reporting. */
function paymentSource(site: CallSite, source: string): string {
  const sourceFile = ts.createSourceFile(site.file, source, ts.ScriptTarget.Latest, true);
  return site.payment ? site.payment.getText(sourceFile) : 'nothing';
}

describe('how a relayed intent takes its payment', () => {
  it('offers no way to record a payment hash without its amount', () => {
    // The type is the fix. Everything else in this file only stops the shape being rebuilt by
    // hand somewhere the type cannot see.
    const request = readFileSync(join(SRC_ROOT, REQUEST_PATH), 'utf8');

    expect(usesSplitPaymentFields(request, REQUEST_PATH), SPLIT_FIELD_EXPLANATION).toBe(false);
    expect(request).toContain('payment?: IntentPaymentReference');
  });

  it('never passes a payment field runRelayedIntent no longer accepts', () => {
    // Every call site either passes `payment` or is free and passes nothing. A site naming
    // `paymentTxHash` or `paymentAmount` is the old split shape coming back, and with it the
    // ability to name a payment settlement cannot act on.
    const splitSites = sourceFiles(SRC_ROOT)
      .flatMap((path) => {
        const relativePath = relative(SRC_ROOT, path);
        return relayedIntentCallSites(readFileSync(path, 'utf8'), relativePath)
          .filter((site) => site.splitFields.length > 0)
          .map((site) => `${site.file}:${site.line} passes ${site.splitFields.join(', ')}`);
      })
      .sort();

    expect(splitSites, SPLIT_FIELD_EXPLANATION).toEqual([]);
  });

  it('requires every paid call site to take its amount from the middleware that settled it', () => {
    const handBuilt = sourceFiles(SRC_ROOT)
      .flatMap((path) => {
        const relativePath = relative(SRC_ROOT, path);
        const source = readFileSync(path, 'utf8');
        return relayedIntentCallSites(source, relativePath)
          .filter((site) => {
            const text = paymentSource(site, source);
            // A shorthand or local alias is fine as long as the file's only source of a
            // payment reference is the middleware helper -- checked below by requiring the
            // import. What is rejected here is an object literal assembled at the call site.
            return text.startsWith('{');
          })
          .map((site) => `${site.file}:${site.line}`);
      })
      .sort();

    expect(handBuilt, HAND_BUILT_EXPLANATION).toEqual([]);

    // Anything that passes a payment must have got it from the one function allowed to
    // produce one. This is what makes tasks.create's reward and tasks.update's reward increase
    // refundable at the price the payer was actually charged, without either route restating a
    // pricing rule the middleware owns.
    const missingImport = sourceFiles(SRC_ROOT)
      .filter((path) => {
        const relativePath = relative(SRC_ROOT, path);
        const source = readFileSync(path, 'utf8');
        const paysSomething = relayedIntentCallSites(source, relativePath).some(
          (site) => site.payment !== undefined
        );
        return paysSomething && !source.includes('settledPaymentReference');
      })
      .map((path) => relative(SRC_ROOT, path))
      .sort();

    expect(missingImport, HAND_BUILT_EXPLANATION).toEqual([]);
  });

  it('lets nothing but the middleware read a settled payment out of res.locals', () => {
    // `res.locals` is untyped, so reading it directly is how a caller reconstructs two thirds
    // of a payment reference and believes it has one. One reader means one place that can get
    // the all-or-nothing rule wrong, and it is the place that wrote the values.
    const readers = sourceFiles(SRC_ROOT)
      .filter((path) => relative(SRC_ROOT, path) !== MIDDLEWARE_PATH)
      .filter((path) => /locals\.payment(TxHash|Amount)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC_ROOT, path))
      .sort();

    expect(
      readers,
      'Read the settled payment through `settledPaymentReference(res)` rather than off `res.locals`. It returns the whole reference or nothing, which is the property that makes an unrefundable half-populated intent impossible to record.'
    ).toEqual([]);
  });

  it('finds a call site and what it passes, rather than matching on text', () => {
    const paid = `runRelayedIntent({ operation: 'x', payment: settledPaymentReference(ctx.res) });`;
    const free = `runRelayedIntent({ operation: 'x', payer: input.workerAddress });`;
    const split = `runRelayedIntent({ operation: 'x', paymentTxHash: hash });`;
    const literal = `runRelayedIntent({ operation: 'x', payment: { amount: 1n, payer: p, txHash: h } });`;

    expect(relayedIntentCallSites(paid)[0].payment).toBeDefined();
    expect(relayedIntentCallSites(free)[0].payment).toBeUndefined();
    expect(relayedIntentCallSites(free)[0].splitFields).toEqual([]);
    expect(relayedIntentCallSites(split)[0].splitFields).toEqual(['paymentTxHash']);
    expect(paymentSource(relayedIntentCallSites(literal)[0], literal).startsWith('{')).toBe(true);
    expect(usesSplitPaymentFields(split)).toBe(true);
    expect(usesSplitPaymentFields(paid)).toBe(false);
  });
});
