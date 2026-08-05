// Implements: ADR-0067
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { vi, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { relayedIntents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

// Availability is decided from the real environment before the stub below supplies a
// DATABASE_URL of its own; a machine with no Postgres must skip rather than try to connect.
const isolatedDatabase = createIsolatedMigratedDatabase('x402_reservation');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();
// The middleware reaches `src/db/client.ts`, which builds its connection from this variable at
// import time. It has to name the isolated database before the dynamic import below, or the
// race under test would be arbitrated by whatever database the stub happens to name.
vi.stubEnv('DATABASE_URL', isolatedDatabase.url);

const { x402Middleware } = await import('../../src/middleware/x402');
const { createServerWallet } = await import('../../src/lib/wallet');
const { getServerConfig } = await import('../../src/config/env');
// The middleware's own pool, opened against the isolated database at import time above.
// Postgres will not drop a database anything is still connected to, so teardown has to end it.
const { closeDatabase } = await import('../../src/db/client');

const AMOUNT = '1000';

/**
 * Every `/settle` the middleware asks for, in order.
 *
 * The whole assertion of this file is its length. A charge is not a row in our database and not
 * a status code we returned -- it is this call, made to the facilitator, after which the payer's
 * USDC has moved and nothing we do afterwards puts it back without a refund.
 */
let settleCalls: unknown[] = [];

function stubFacilitator() {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!String(url).endsWith('/settle')) throw new Error(`unexpected fetch to ${String(url)}`);
    settleCalls.push(JSON.parse(String(init.body)));
    return {
      ok: true,
      json: async () => ({
        success: true,
        transaction: `0x${settleCalls.length.toString(16).padStart(64, '0')}`,
      }),
    } as unknown as Response;
  });
}

/**
 * A payment payload the middleware will accept, signed by nobody.
 *
 * Signature validity is the facilitator's question and the facilitator is stubbed, so what
 * matters here is only that the payload passes the middleware's own shape and amount checks --
 * which is what decides whether it reaches `/settle`, and therefore what this test counts.
 */
function paymentHeader(payer: string): string {
  const config = getServerConfig();
  const payTo = createServerWallet().address;
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: `eip155:${config.CHAIN_ID}`,
        amount: AMOUNT,
        asset: config.USDC_TOKEN_ADDRESS,
        payTo,
      },
      payload: {
        authorization: {
          from: payer,
          to: payTo,
          value: AMOUNT,
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 300),
          nonce: `0x${randomUUID().replaceAll('-', '').repeat(2)}`,
        },
      },
    })
  ).toString('base64');
}

const app = express();
app.use(express.json());
app.post(
  '/paid',
  x402Middleware({ getAmount: () => AMOUNT, description: 'Concurrency probe' }),
  (_req, res) => {
    res.json({ ok: true });
  }
);

describeWithDatabase('x402 reservation claims the idempotency key before the challenge', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await closeDatabase();
    await isolatedDatabase.stop();
    vi.unstubAllGlobals();
    restoreServerEnvironment();
  });

  beforeEach(async () => {
    settleCalls = [];
    stubFacilitator();
    await database.delete(relayedIntents);
  });

  /**
   * The defect ADR-0067 exists to close, stated as an assertion.
   *
   * Two requests carrying the same idempotency key, in flight at the same time. This is not a
   * broken client: sending the same key on a retry is exactly the behaviour an idempotency key
   * exists to make safe, and the only thing separating this from the sequential retry the code
   * already handles is that the second request arrives before the first has finished.
   *
   * Under the pre-ADR-0067 ordering both requests read an unclaimed key, both are challenged,
   * and both settle -- so `settleCalls` has length 2 and this fails with
   * `expected 2 to be 1`. The payer is charged twice for one operation, and the second payment
   * has nothing pointing at it.
   */
  it('charges exactly once when two requests present the same key concurrently', async () => {
    const key = randomUUID();
    const payer = '0x1111111111111111111111111111111111111111';

    const responses = await Promise.all([
      request(app)
        .post('/paid')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .set('payment-signature', paymentHeader(payer))
        .send({}),
      request(app)
        .post('/paid')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .set('payment-signature', paymentHeader(payer))
        .send({}),
    ]);

    expect(settleCalls).toHaveLength(1);

    // And the loser is refused, rather than quietly succeeding on the winner's payment.
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body?.taskmarket?.reason).toBe('idempotency_key_reused');
  });

  /**
   * The same race one step earlier: two requests that have not yet been challenged.
   *
   * A client that asks for the 402 first (the ordinary x402 handshake) must also lose the race
   * before it is told the price, not after it has paid it. Nothing settles on this path, so the
   * evidence is that exactly one of them is quoted at all.
   */
  it('refuses the second request before challenging it', async () => {
    const key = randomUUID();

    const responses = await Promise.all([
      request(app).post('/paid').set(IDEMPOTENCY_KEY_HEADER, key).send({}),
      request(app).post('/paid').set(IDEMPOTENCY_KEY_HEADER, key).send({}),
    ]);

    expect(settleCalls).toHaveLength(0);
    expect(responses.map((response) => response.status).sort()).toEqual([402, 409]);
  });

  /**
   * The reservation exists as a row before any money is asked for, and it is not broadcastable.
   *
   * `status = 'reserved'` is the structural half of that guarantee -- every query that hands an
   * intent to the chain requires `recorded` -- and this is the assertion that the pre-402 path
   * actually reaches that state rather than merely intending to.
   */
  it('records a reserved, payment-required intent for an unanswered challenge', async () => {
    const key = randomUUID();
    await request(app).post('/paid').set(IDEMPOTENCY_KEY_HEADER, key).send({});

    const [row] = await database.select().from(relayedIntents);
    expect(row.idempotencyKey).toBe(key);
    expect(row.status).toBe('reserved');
    expect(row.paymentRequired).toBe(true);
    expect(row.paymentTxHash).toBeNull();
    expect(row.reservedExpiresAt).not.toBeNull();
  });

  /**
   * The write-ahead record of the authorization (ADR-0067).
   *
   * It must be on the row *before* the facilitator is asked to settle, because the case it
   * exists for is the process dying in between. So the evidence is taken from inside the
   * `/settle` stub rather than after the request returns: asserting afterwards would pass just
   * as happily if the write happened on the way back.
   */
  it('records the authorization it is about to settle before settling it', async () => {
    const key = randomUUID();
    const payer = '0x2222222222222222222222222222222222222222';
    let rowAtSettleTime: typeof relayedIntents.$inferSelect | undefined;

    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      settleCalls.push(JSON.parse(String(init.body)));
      [rowAtSettleTime] = await database.select().from(relayedIntents);
      return {
        ok: true,
        json: async () => ({ success: true, transaction: `0x${'ab'.repeat(32)}` }),
      } as unknown as Response;
    });

    const header = paymentHeader(payer);
    const nonce = JSON.parse(Buffer.from(header, 'base64').toString()).payload.authorization.nonce;

    await request(app)
      .post('/paid')
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .set('payment-signature', header)
      .send({});

    expect(rowAtSettleTime?.paymentAuthNonce).toBe(nonce);
    expect(rowAtSettleTime?.paymentAuthPayer?.toLowerCase()).toBe(payer.toLowerCase());
    expect(rowAtSettleTime?.paymentAuthAmount).toBe(AMOUNT);
    // And it is not evidence money moved: the payment reference is still absent at this point.
    expect(rowAtSettleTime?.paymentTxHash).toBeNull();
  });
});
