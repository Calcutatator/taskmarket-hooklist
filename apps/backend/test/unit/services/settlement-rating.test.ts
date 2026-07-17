import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { taskAwards } from '../../../src/db/schema';
import { projectSettlementRating } from '../../../src/services/settlement-rating';
import { createMockCtx, makeChain } from '../helpers';

describe('settlement rating projection', () => {
  it('updates every matching award row for the recipient', async () => {
    const ctx = createMockCtx();
    const awardUpdate = makeChain([]);
    ctx.db.update.mockReturnValueOnce(awardUpdate);

    await projectSettlementRating(ctx.db, {
      rating: 88,
      taskId: '0xtask',
      workerAddress: '0x0000000000000000000000000000000000000002',
    });

    expect(ctx.db.transaction).toHaveBeenCalledOnce();
    expect(ctx.db.update).toHaveBeenCalledOnce();
    expect(ctx.db.update).toHaveBeenNthCalledWith(1, taskAwards);
    expect(awardUpdate.set).toHaveBeenCalledWith({ rating: 88 });
    expect(awardUpdate.where).toHaveBeenCalledOnce();

    const awardWhere = awardUpdate.where.mock.calls[0]?.[0];
    const awardQuery = new PgDialect().sqlToQuery(awardWhere);
    expect(awardQuery.sql).toContain('lower("task_awards"."worker_address")');
  });
});
