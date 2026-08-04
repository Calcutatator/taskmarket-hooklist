// Verifies: ADR-0045
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntentCtx, createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRegisterIdentityTx: vi.fn().mockResolvedValue('0xregistertx'),
  resolveRegisteredAgentId: vi.fn().mockResolvedValue(42n),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn(() => ({
    ERC8004_IDENTITY_REGISTRY: '0xRegistryCurrent000000000000000000000000',
    CHAIN_ID: 84532,
  })),
}));

const REGISTRY = '0xRegistryCurrent000000000000000000000000';
const CHAIN_ID = 84532;

import { identityRouter } from '../../../src/routers/identity.router';
import { contractRegisterIdentityTx } from '../../../src/services/contract';
import { agents } from '../../../src/db/schema';

// Carries hex letters on purpose. An all-digit address is unchanged by a case transform, so
// the casing tests below would have asserted nothing at all against one.
const PAYER = '0xab5cde1111111111111111111111111111119fed';
// Only the letters change case; the `0x` prefix stays lowercase, as every caller sends it.
const PAYER_UPPERCASED = `0x${PAYER.slice(2).toUpperCase()}`;

describe('identity router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    // The mint is a relayed intent now (ADR-0045): the agentId is decoded from the
    // transaction's own Registered event by the completion handler and read back from the
    // row, so every mint path ends with a lookup of the freshly written agent id.
    function mintCtx(payer: string, existing: unknown[]) {
      const ctx = createIntentCtx(payer);
      ctx.db.select
        .mockReturnValueOnce(makeChain(existing))
        // linkIntentToBroadcast's outbox lookup after the chain call.
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ agentId: '42' }]));
      return ctx;
    }

    it('mints and inserts a new lowercased row when the address has never been seen', async () => {
      const ctx = mintCtx(PAYER, []);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentityTx).toHaveBeenCalledOnce();
      expect(ctx.insertChain(agents).values).toHaveBeenCalledWith(
        expect.objectContaining({ address: PAYER.toLowerCase(), agentId: '42' })
      );
      expect(ctx.updateChain(agents).set).not.toHaveBeenCalled();
    });

    it('returns the existing agentId without minting when already registered under any casing', async () => {
      const ctx = createIntentCtx(PAYER_UPPERCASED);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { address: PAYER, agentId: '7', identityRegistryAddress: REGISTRY, chainId: CHAIN_ID },
        ])
      );
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '7', alreadyRegistered: true });
      expect(contractRegisterIdentityTx).not.toHaveBeenCalled();
      expect(ctx.insertChain(agents).values).not.toHaveBeenCalled();
    });

    it('re-registers instead of trusting a cached agentId minted against a different (e.g. redeployed) registry', async () => {
      // The cached agentId is for a registry contract that is no longer the one configured --
      // it may not even resolve to this address on the live registry, so it must not be
      // served as if it were still valid.
      const ctx = mintCtx(PAYER, [
        {
          address: PAYER,
          agentId: '7',
          identityRegistryAddress: '0xRegistryOld00000000000000000000000000',
          chainId: CHAIN_ID,
        },
      ]);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentityTx).toHaveBeenCalledOnce();
      expect(ctx.updateChain(agents).set).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: '42',
          identityRegistryAddress: REGISTRY.toLowerCase(),
          chainId: CHAIN_ID,
        })
      );
    });

    it('re-registers instead of trusting a cached agentId minted on a different chain, even with a matching registry address', async () => {
      // ERC-8004 identity registries are commonly deployed at the SAME address on every chain
      // (deterministic/CREATE2 deployment), so registry address alone cannot tell a genuinely
      // fresh cache apart from one minted on a different chain.
      const ctx = mintCtx(PAYER, [
        { address: PAYER, agentId: '7', identityRegistryAddress: REGISTRY, chainId: 8453 },
      ]);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentityTx).toHaveBeenCalledOnce();
      expect(ctx.updateChain(agents).set).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: '42', chainId: CHAIN_ID })
      );
    });

    it('re-registers when the cached row has an agentId but no identityRegistryAddress or chainId at all (pre-migration row)', async () => {
      const ctx = mintCtx(PAYER, [
        { address: PAYER, agentId: '7', identityRegistryAddress: null, chainId: null },
      ]);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      expect(contractRegisterIdentityTx).toHaveBeenCalledOnce();
    });

    it('updates the existing row in place by its stored address instead of inserting a duplicate when a legacy differently-cased row has no agentId yet', async () => {
      const legacyMixedCaseAddress = '0xAbCd111111111111111111111111111111111111';
      const ctx = mintCtx(PAYER, [{ address: legacyMixedCaseAddress, agentId: null }]);
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.register({});

      expect(result).toEqual({ agentId: '42', alreadyRegistered: false });
      // Must update the row that was actually found, not insert a second row for the
      // lowercased payer address -- that would split one real-world address across two rows.
      expect(ctx.updateChain(agents).set).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: '42' })
      );
      expect(ctx.insertChain(agents).values).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('finds a registration regardless of address casing', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentId: '5' }]));
      const caller = identityRouter.createCaller(ctx);

      const result = await caller.status({ address: PAYER_UPPERCASED });

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
