/**
 * An agent lookup by address must not care about case.
 *
 * `agents.address` is stored lowercase. The addresses it gets looked up against are not:
 * `submissions.workerAddress` and `tasks.requester` hold checksummed (mixed-case) values. A
 * lookup that compares them directly is a case-sensitive string match, so it misses essentially
 * every row, and the caller falls back to whatever it does when no agent is found -- in the case
 * that surfaced this, rendering a raw wallet address where a registered agent's name belonged.
 *
 * It failed quietly for two reasons worth keeping in mind. The map built from the query result
 * already lowercased both sides, so the code *looked* case-safe at the point a reader would
 * check; and the same file did the comparison correctly a few lines further down. Nothing threw,
 * and 1 submission in 103 resolved -- the one whose address happened to have been written
 * lowercase -- so the surface looked partly working rather than broken.
 *
 * This runs against a real migrated database because the defect is in SQL. A mocked store
 * compares however the mock chooses to compare, which is exactly the thing in question.
 */
import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('agent_address_case');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

afterAll(restoreServerEnvironment);

// The same address in the two casings the two tables actually store.
const CHECKSUMMED = '0x03dB205d6a3BE1bd80d5086f8F78F42B813F4a73';
const LOWERCASE = CHECKSUMMED.toLowerCase();
const AGENT_ID = '60048';

describeWithDatabase('agent lookup by address is case-insensitive', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
    await database.insert(agents).values({ address: LOWERCASE, agentId: AGENT_ID });
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('finds the agent when the caller holds a checksummed address', async () => {
    // The defect, stated as a passing test. The routers look agents up with addresses taken from
    // submission and task rows, which are checksummed.
    const rows = await database
      .select({ agentId: agents.agentId })
      .from(agents)
      .where(
        inArray(
          sql`lower(${agents.address})`,
          [CHECKSUMMED].map((address) => address.toLowerCase())
        )
      );

    expect(rows.map((row) => row.agentId)).toEqual([AGENT_ID]);
  });

  it('demonstrates the case-sensitive form that was there before', async () => {
    // Kept deliberately: it is the whole bug in two lines, and it documents that the old query
    // returned an empty result rather than raising anything a caller could notice.
    const rows = await database
      .select({ agentId: agents.agentId })
      .from(agents)
      .where(inArray(agents.address, [CHECKSUMMED]));

    expect(rows).toEqual([]);
  });

  it('still finds the agent when the caller holds a lowercase address', async () => {
    // The 1-in-103 that used to work must keep working.
    const rows = await database
      .select({ agentId: agents.agentId })
      .from(agents)
      .where(
        inArray(
          sql`lower(${agents.address})`,
          [LOWERCASE].map((address) => address.toLowerCase())
        )
      );

    expect(rows.map((row) => row.agentId)).toEqual([AGENT_ID]);
  });

  it('does not match an unrelated address', async () => {
    const rows = await database
      .select({ agentId: agents.agentId })
      .from(agents)
      .where(
        inArray(
          sql`lower(${agents.address})`,
          [`0x${'11'.repeat(20)}`].map((address) => address.toLowerCase())
        )
      );

    expect(rows).toEqual([]);
  });
});
