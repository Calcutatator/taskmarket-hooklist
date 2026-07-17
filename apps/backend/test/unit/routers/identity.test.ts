import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRegisterIdentity: vi.fn().mockResolvedValue(42n),
}));

import { identityRouter } from '../../../src/routers/identity.router';
import { contractRegisterIdentity } from '../../../src/services/contract';

const PAYER = '0x1111111111111111111111111111111111111111';

describe('identity router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('mints and inserts a new lowercased row when the address has never been seen', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const insertChain = makeChain();
      ctx.db.insert.mockReturnValueOnce(insertChain);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledOnce();
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ address: PAYER.toLowerCase(), agentId: '42' })
      );
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('returns the existing agentId without minting when already registered under any casing', async () => {
      const ctx = createMockCtx(PAYER.toUpperCase());
      ctx.db.select.mockReturnValueOnce(makeChain([{ address: PAYER, agentId: '7' }]));
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '7', alreadyRegistered: true });
      expect(contractRegisterIdentity).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });

    it('updates the existing row in place by its stored address instead of inserting a duplicate when a legacy differently-cased row has no agentId yet', async () => {
      const legacyMixedCaseAddress = '0xAbCd111111111111111111111111111111111111';
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ address: legacyMixedCaseAddress, agentId: null }])
      );
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
      // Must update the row that was actually found, not insert a second row
      // for the lowercased payer address -- that would split one real-world
      // address across two agents rows.
      expect(ctx.db.update).toHaveBeenCalledOnce();
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ agentId: '42' }));
    });
  });

  describe('status', () => {
    it('finds a registration regardless of address casing', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentId: '5' }]));
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.status({ address: PAYER.toUpperCase() });

      expect(result).toEqual({ agentId: '5', registered: true });
    });

    it('reports unregistered when no row matches', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.status({ address: PAYER });

      expect(result).toEqual({ agentId: null, registered: false });
    });
  });
});
