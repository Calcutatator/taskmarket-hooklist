import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  agents,
  indexedEvents,
  platformFees,
  requesterReputationEvents,
  taskAwards,
  tasks,
} from '../../src/db/schema';
import { processIndexedEvent } from '../../src/services/indexer-event';
import { recordRequesterReputationEvent } from '../../src/services/requester-reputation-recorder';
import { recordTaskSettlement } from '../../src/services/settlement-recorder';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('settlement', { maxConnections: 12 });
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const taskIds: string[] = [];
const workerAddresses: string[] = [];
const reputationTaskIds: string[] = [];

describeWithDatabase('settlement recorder', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    for (const taskId of taskIds.splice(0)) {
      await database.delete(indexedEvents).where(eq(indexedEvents.txHash, taskId));
      await database.delete(platformFees).where(eq(platformFees.taskId, taskId));
      await database.delete(taskAwards).where(eq(taskAwards.taskId, taskId));
      await database.delete(tasks).where(eq(tasks.id, taskId));
    }
    for (const address of workerAddresses.splice(0)) {
      await database.delete(agents).where(eq(agents.address, address));
    }
    for (const taskId of reputationTaskIds.splice(0)) {
      await database
        .delete(requesterReputationEvents)
        .where(eq(requesterReputationEvents.taskId, taskId));
    }
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('records every duplicate-recipient award exactly once under concurrent replay', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const taskId = `test-settlement-${suffix}`;
    const transactionHash = taskId;
    const workerAddress = `0x${suffix.slice(0, 40).padEnd(40, '0')}`;
    taskIds.push(taskId);
    workerAddresses.push(workerAddress);

    await database.insert(tasks).values({
      description: 'Concurrent settlement integration test',
      escrowTxHash: `escrow-${suffix}`,
      expiryTime: new Date('2030-01-01T00:00:00.000Z'),
      id: taskId,
      mode: 'bounty',
      requester: '0x0000000000000000000000000000000000000001',
      requesterPubkey: 'test-public-key',
      reward: '1000',
      status: 'open',
      tags: ['typescript'],
    });
    await database.insert(agents).values({ address: workerAddress });

    const input = {
      chainId: 8453,
      settledAt: new Date('2026-07-15T00:00:00.000Z'),
      settlement: {
        awards: [
          {
            blockNumber: 123456n,
            grossAmount: 600n,
            isPrimary: true,
            logIndex: 17,
            platformFee: 30n,
            rank: 1,
            workerAddress,
            workerPayment: 570n,
          },
          {
            blockNumber: 123456n,
            grossAmount: 400n,
            isPrimary: false,
            logIndex: 18,
            platformFee: 20n,
            rank: 2,
            workerAddress,
            workerPayment: 380n,
          },
        ],
        blockNumber: 123456n,
        primaryWorker: workerAddress,
        taskId,
        transactionHash,
      },
    };

    await Promise.all(Array.from({ length: 8 }, () => recordTaskSettlement(database, input)));

    const [awardRows, feeRows, workerRows, markerRows] = await Promise.all([
      database.select().from(taskAwards).where(eq(taskAwards.taskId, taskId)),
      database.select().from(platformFees).where(eq(platformFees.taskId, taskId)),
      database.select().from(agents).where(eq(agents.address, workerAddress)),
      database.select().from(indexedEvents).where(eq(indexedEvents.txHash, transactionHash)),
    ]);

    expect(awardRows).toHaveLength(2);
    expect(feeRows.map((row) => row.amount).sort()).toEqual(['20', '30']);
    expect(workerRows).toEqual([
      expect.objectContaining({ completedTasks: 2, totalEarnings: '950' }),
    ]);
    expect(markerRows).toHaveLength(2);
  });

  it('retries requester reputation after a marker failure without duplicating its projection', async () => {
    const taskId = `requester-reputation-${randomUUID()}`;
    taskIds.push(taskId);
    reputationTaskIds.push(taskId);
    const projection = {
      eventType: 'completed',
      requester: '0x0000000000000000000000000000000000000001',
      reward: '1000',
      selfAward: false,
      submissionCount: 2,
      taskId,
      uniqueWorkers: 2,
    };
    const event = {
      ...projection,
      blockNumber: 234567n,
      logIndex: 19,
      transactionHash: taskId,
    };
    let markerAttempts = 0;
    const dependencies = {
      isAlreadyProcessed: async () => {
        const rows = await database
          .select({ logIndex: indexedEvents.logIndex })
          .from(indexedEvents)
          .where(eq(indexedEvents.txHash, taskId));
        return rows.length > 0;
      },
      markProcessed: async () => {
        markerAttempts += 1;
        if (markerAttempts === 1) throw new Error('marker write failed');
        await database.insert(indexedEvents).values({
          blockNumber: event.blockNumber,
          chainId: 8453,
          eventName: 'RequesterReputation',
          logIndex: event.logIndex,
          txHash: event.transactionHash,
        });
      },
      processEvent: async () => {
        await recordRequesterReputationEvent(database, projection);
      },
    };

    await expect(processIndexedEvent(event, dependencies)).rejects.toThrow('marker write failed');
    await expect(processIndexedEvent(event, dependencies)).resolves.toBe(true);
    await expect(processIndexedEvent(event, dependencies)).resolves.toBe(false);

    const [projectionRows, markerRows] = await Promise.all([
      database
        .select()
        .from(requesterReputationEvents)
        .where(eq(requesterReputationEvents.taskId, taskId)),
      database.select().from(indexedEvents).where(eq(indexedEvents.txHash, taskId)),
    ]);
    expect(projectionRows).toHaveLength(1);
    expect(markerRows).toHaveLength(1);
    expect(markerAttempts).toBe(2);
  });
});
