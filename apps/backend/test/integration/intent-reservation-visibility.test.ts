// Verifies: ADR-0059, ADR-0067
//
// A reservation is the one intent that exists before its payer does, and the 409 that creates it
// tells the caller to read its outcome from `intents.get`. Against a real database, because the
// question is which row a lookup resolves and by which handle -- the visibility rule is only
// meaningful on top of the query that finds the row.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { envelopeForError } from '../../src/lib/api-error';
import { relayedIntents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_visibility');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

const { intentsRouter } = await import('../../src/routers/intents.router');
const { recordIntentPaymentAuthorization, recordRelayedIntent, reserveRelayedWrite } = await import(
  '../../src/services/relayed-intents'
);

const CALLER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

/** Lowercased the way `resolveCaller` lowercases a verified address. */
function callerFor(address: string) {
  return {
    db: database,
    req: {},
    res: { locals: {} },
    caller: { address: address.toLowerCase() },
  };
}

function get(address: string, input: { intentId?: string; idempotencyKey?: string }) {
  return intentsRouter.createCaller(callerFor(address) as never).get(input);
}

/**
 * The whole answer a refused lookup gives: its classified reason and its prose.
 *
 * Both, because either alone is too weak for what these tests compare. Two calls that agree
 * only on a message agree just as well when a broken database makes both of them throw the
 * same thing, and the reason is what a client actually branches on (ADR-0049 point 3).
 */
function answerFor(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (error: Error) => `${envelopeForError(error).reason}: ${error.message}`
  );
}

/** What `intents.get` answers for anything the caller may not see. */
const NOT_FOUND_ANSWER = 'intent_not_found: No such intent';

describeWithDatabase('a reservation is readable by the holder of its idempotency key', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  beforeEach(async () => {
    await database.delete(relayedIntents);
  });

  it('answers the key holder, whom the 409 told to poll here', async () => {
    const key = randomUUID();
    const reserved = (await reserveRelayedWrite({ db: database, key, route: '/paid' })).intent!;

    const status = await get(CALLER, { idempotencyKey: key });

    expect(status).toMatchObject({ intentId: reserved.id, idempotencyKey: key });
    // Non-terminal, and reported as itself rather than as a 500 out of the output schema.
    expect(status.status).toBe('reserved');
    expect(status.terminalReason).toBeNull();
    expect(status.txHash).toBeNull();
  });

  it('answers the payer recorded before settlement, without a key', async () => {
    const key = randomUUID();
    const reserved = (await reserveRelayedWrite({ db: database, key })).intent!;
    await recordIntentPaymentAuthorization({
      db: database,
      amount: '1000',
      intentId: reserved.id,
      nonce: `0x${'33'.repeat(32)}`,
      payer: CALLER,
    });

    // Once the middleware writes the authorization down, an address *is* recorded and the
    // ordinary ADR-0059 comparison has something to compare against again.
    expect((await get(CALLER, { intentId: reserved.id })).status).toBe('reserved');
  });

  describe('and nothing about that makes this surface an enumeration oracle', () => {
    it('says the same thing to a key that names nothing as to a key that names another caller’s settled intent', async () => {
      const key = randomUUID();
      await recordRelayedIntent({
        db: database,
        idempotencyKey: key,
        operation: 'tasks.create',
        payer: OTHER,
        payload: { note: 'not yours' },
      });

      const asStranger = answerFor(get(CALLER, { idempotencyKey: key }));
      const asNobody = answerFor(get(CALLER, { idempotencyKey: randomUUID() }));

      // A key is a credential only where no initiator was recorded. Holding one for an intent
      // that has a payer buys nothing, so a leaked key cannot open a settled write.
      //
      // Named, not merely "not resolved": a broken database would make both calls throw the
      // same message and satisfy the equality on its own. The equality stays because
      // indistinguishability is the property being protected -- this only pins which answer
      // both calls are giving.
      expect(await asStranger).toBe(NOT_FOUND_ANSWER);
      expect(await asStranger).toBe(await asNobody);
    });

    it('says the same thing to a reservation’s id as to an id that names nothing', async () => {
      const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;

      const byId = answerFor(get(CALLER, { intentId: reserved.id }));
      const byNothing = answerFor(get(CALLER, { intentId: randomUUID() }));

      // The id path is unchanged. An id proves nothing about who is asking, so the only way to
      // reach a reservation is to already hold the UUID a client minted for it.
      expect(await byId).toBe(NOT_FOUND_ANSWER);
      expect(await byId).toBe(await byNothing);
    });
  });
});
