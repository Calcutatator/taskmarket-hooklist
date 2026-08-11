import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayedIntents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

// Availability is decided from the real environment, so this has to run before the stub below
// supplies a DATABASE_URL of its own -- otherwise a machine with no Postgres would look
// available and the suite would try to connect instead of skipping.
const isolatedDatabase = createIsolatedMigratedDatabase('intent_payload');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

// The service module reaches the logger, which reads the server config at import time and
// exits the process when it is not satisfied. Stubbed before the dynamic import so this file
// can still be collected where the suite above only skips.
const restoreServerEnvironment = stubServerEnvironment();

const { canonicalizeIntentPayload } = await import('../../src/services/relayed-intents');

/**
 * Store a payload the way a relayed write does, and read back what `jsonb` made of it.
 *
 * The point of going through the real column rather than a `JSON.parse(JSON.stringify(...))`
 * stand-in is that the stand-in cannot fail the way the storage can. `jsonb` reorders keys by
 * its own rule, renumbers anything numeric into its own textual form, and collapses values a
 * second in-memory object would have kept -- none of which an in-process round trip reproduces.
 * A canonical form asserted only against a simulated trip is asserted against the wrong thing.
 */
async function storeAndReadBack(payload: unknown): Promise<unknown> {
  const id = randomUUID();
  await database.insert(relayedIntents).values({
    chainId: 84532,
    id,
    idempotencyKey: randomUUID(),
    operation: 'claims.claim',
    payload,
    relayReceiptNonce: '0x00',
    relayValidBefore: '0',
    status: 'recorded',
  });
  const [row] = await database.select().from(relayedIntents).where(eq(relayedIntents.id, id));
  return row.payload;
}

/**
 * Each case is a payload shape a real intent carries, or a shape that would expose a specific
 * way the round trip could change a value. The assertion is always the same and is the whole
 * property the mismatch guard rests on: a payload must canonicalise to what its own stored copy
 * canonicalises to. If any of these ever fails, the guard rejects a legitimate retry -- the
 * failure ADR-0061 names as worse than the bug it fixes.
 */
const cases: Array<[string, unknown]> = [
  ['a flat payload', { contractAddress: '0xabc', taskId: 't-1', workerAddress: '0xdef' }],
  // jsonb has its own key ordering and does not preserve insertion order, so two spellings of
  // one object must not be told apart. This is the case that fails without the recursive sort.
  ['keys in a different order', { m: { y: 1, b: 2 }, taskId: 't-1', a: 2, z: 1 }],
  // `JSON.stringify` drops these, so the stored row never holds the distinction and the
  // canonical form must not either.
  ['a present-but-undefined property', { a: 1, note: undefined, taskId: 't-1' }],
  ['undefined inside an array', { artifacts: [1, undefined, 3] }],
  ['an explicit null', { evaluator: null, taskId: 't-1' }],
  // Award splits and artifact manifests are arrays of objects; this is the common real shape.
  [
    'an array of objects',
    {
      awards: [
        { bps: 5000, worker: '0xA' },
        { bps: 5000, worker: '0xB' },
      ],
    },
  ],
  [
    'an artifact manifest',
    {
      artifacts: [
        { displayOrder: 0, id: 'a-0', storageKey: 'submissions/t-1/a-0' },
        { displayOrder: 1, id: 'a-1', storageKey: 'submissions/t-1/a-1' },
      ],
      submissionId: 's-1',
    },
  ],
  ['a Date', { deadline: new Date('2026-01-01T00:00:00.000Z') }],
  // USDC base units travel as decimal strings, which is what makes them safe: a string is not
  // renumbered by jsonb and does not lose precision through JSON.parse the way a wide number
  // would.
  ['a reward as a decimal string', { amountBaseUnits: '1000000', reward: '250000000' }],
  ['numbers jsonb renders its own way', { a: 0.1, b: 0.30000000000000004, c: 5e-7, d: 1e21 }],
  ['integers at the edge of exact representation', { a: 9007199254740991, b: -0 }],
  ['values JSON turns into null', { a: NaN, b: Infinity }],
  ['booleans', { a: false, b: true }],
  ['empty containers', { a: {}, b: [] }],
  ['deep nesting', { a: { b: { c: { d: [{ e: 1 }] } } } }],
  ['keys that sort by more than length', { '10': 'c', '1': 'a', '2': 'b', x: 'y' }],
  ['non-ascii text', { note: 'café — 日本語 — Ωμέγα — Привет', title: 'a"b\\c\nd\te — naïve' }],
];

describeWithDatabase('relayed intent payload canonicalisation over jsonb', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  it.each(cases)('survives a real jsonb round trip: %s', async (_name, payload) => {
    const stored = await storeAndReadBack(payload);
    expect(canonicalizeIntentPayload(stored)).toBe(canonicalizeIntentPayload(payload));
  });

  it('ignores key order inside an array element, which is where a rebuilt payload shifts it', async () => {
    // The named risk: an award split or artifact manifest rebuilt from a `Map` on the retry
    // emits each element's keys in whatever order the map iterates, which is not the order the
    // first attempt used. The elements themselves are in the same order and carry the same
    // values, so this is the same write and must compare equal. Sorting only at the top level
    // would miss it, since the difference is two levels down inside an array.
    const stored = await storeAndReadBack({
      awards: [
        { amount: '250000', rank: 1, worker: '0xA' },
        { amount: '250000', rank: 2, worker: '0xB' },
      ],
    });

    expect(
      canonicalizeIntentPayload({
        awards: [
          { worker: '0xA', amount: '250000', rank: 1 },
          { rank: 2, worker: '0xB', amount: '250000' },
        ],
      })
    ).toBe(canonicalizeIntentPayload(stored));
  });

  it('still tells a genuinely different payload apart after the round trip', async () => {
    // The guard is only worth having if it survives canonicalisation with its teeth: a changed
    // value and a reordered array are the two differences that must not be normalised away,
    // since array order carries meaning in an award split.
    const stored = await storeAndReadBack({ awards: [{ bps: 6000 }, { bps: 4000 }], reward: '1' });

    expect(canonicalizeIntentPayload(stored)).not.toBe(
      canonicalizeIntentPayload({ awards: [{ bps: 6000 }, { bps: 4000 }], reward: '2' })
    );
    expect(canonicalizeIntentPayload(stored)).not.toBe(
      canonicalizeIntentPayload({ awards: [{ bps: 4000 }, { bps: 6000 }], reward: '1' })
    );
  });

  it('cannot store a bigint at all, which is why one is never read back', async () => {
    // The canonical form turns a bigint into its decimal string, and the reason that is safe
    // rather than lossy is here: the driver refuses to serialise one, so no stored payload has
    // ever held a bigint for an incoming bigint to be compared against. A payload that carries
    // one fails on its first attempt, at the insert -- never as a mismatch on a retry.
    await expect(storeAndReadBack({ reward: 1_000n })).rejects.toThrow();
  });
});
