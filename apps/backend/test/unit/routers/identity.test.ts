import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRegisterIdentity: vi.fn().mockResolvedValue(42n),
}));

const REGISTRY = '0xRegistryCurrent000000000000000000000000';
const CHAIN_ID = 84532;
vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn(() => ({ ERC8004_IDENTITY_REGISTRY: REGISTRY, CHAIN_ID })),
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
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { address: PAYER, agentId: '7', identityRegistryAddress: REGISTRY, chainId: CHAIN_ID },
        ])
      );
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '7', alreadyRegistered: true });
      expect(contractRegisterIdentity).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });

    it('re-registers instead of trusting a cached agentId minted against a different (e.g. redeployed) registry', async () => {
      // The cached agentId is for a registry contract that is no longer the
      // one configured -- it may not even resolve to this address on the
      // live registry, so it must not be served as if it were still valid.
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          {
            address: PAYER,
            agentId: '7',
            identityRegistryAddress: '0xRegistryOld00000000000000000000000000',
            chainId: CHAIN_ID,
          },
        ])
      );
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: '42',
          identityRegistryAddress: REGISTRY.toLowerCase(),
          chainId: CHAIN_ID,
        })
      );
    });

    it('re-registers instead of trusting a cached agentId minted on a different chain, even with a matching registry address', async () => {
      // ERC-8004 identity registries are commonly deployed at the SAME address
      // on every chain (deterministic/CREATE2 deployment), so registry address
      // alone cannot tell a genuinely fresh cache apart from one minted on a
      // different chain the database was previously pointed at.
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { address: PAYER, agentId: '7', identityRegistryAddress: REGISTRY, chainId: 8453 },
        ])
      );
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: '42', chainId: CHAIN_ID })
      );
    });

    it('re-registers when the cached row has an agentId but no identityRegistryAddress or chainId at all (pre-migration row)', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ address: PAYER, agentId: '7', identityRegistryAddress: null, chainId: null }])
      );
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
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

      expect(result).toEqual({ agentId: '5', registered: true, cacheFresh: false });
    });

    it('reports unregistered when no row matches', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.status({ address: PAYER });

      expect(result).toEqual({ agentId: null, registered: false, cacheFresh: false });
    });

    it('reports cacheFresh: true when identityRegistryAddress/chainId match', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ agentId: '5', identityRegistryAddress: REGISTRY, chainId: CHAIN_ID }])
      );
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.status({ address: PAYER });

      expect(result).toEqual({ agentId: '5', registered: true, cacheFresh: true });
    });
  });
});
