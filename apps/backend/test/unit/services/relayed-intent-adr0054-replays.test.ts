// Verifies: ADR-0050
// Verifies: ADR-0054
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { toFunctionSelector } from 'viem';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

/**
 * The two operations ADR-0054 unblocked, and the revert each one's replay lands on.
 *
 * Both were excluded from rebroadcasting because a second landing moved money the chain would
 * not stop -- `refundExpired` paying a second refund out of the pooled escrow every task shares,
 * `updateTask` keeping a forwarder-pulled delta it then silently declined to apply. ADR-0054
 * closed each on chain rather than by argument, and these are the reverts that did it. Every
 * property below is about that: the replay is refused by the contract, and refused *terminally*.
 */
const OPERATIONS = [
  {
    args: [`0x${'a'.repeat(64)}`, '0x1111111111111111111111111111111111111111', 7n],
    contractFn: 'contractRefundExpired',
    operation: 'tasks.refundExpired',
    payload: { requesterAgentId: '7', taskId: `0x${'a'.repeat(64)}` },
    revert: 'TaskAlreadyRefunded',
  },
  {
    args: [
      `0x${'a'.repeat(64)}`,
      '0x1111111111111111111111111111111111111111',
      2_500_000n,
      1_900_000_000n,
      0n,
      0n,
      1_000_000n,
      '0x0000000000000000000000000000000000000009',
    ],
    contractFn: 'contractUpdateTask',
    operation: 'tasks.update',
    payload: {
      contractAddress: '0x0000000000000000000000000000000000000009',
      currentReward: '1000000',
      dbUpdate: { reward: '2500000' },
      newBidDeadline: '0',
      newExpiryTime: '1900000000',
      newPitchDeadline: '0',
      newReward: '2500000',
      taskId: `0x${'a'.repeat(64)}`,
    },
    revert: 'NoRewardChange',
  },
] as const;

const PAYER = '0x1111111111111111111111111111111111111111';
const PAYMENT_TX = `0x${'ab'.repeat(32)}`;

vi.mock('../../../src/services/contract', () => ({
  contractAcceptAuction: vi.fn(),
  contractAcceptSubmission: vi.fn(),
  contractAcceptSubmissions: vi.fn(),
  contractAppeal: vi.fn(),
  contractAssignEvaluator: vi.fn(),
  contractCancelTask: vi.fn(),
  contractEvaluate: vi.fn(),
  contractEvaluatorTimeout: vi.fn(),
  contractFinalizeVerdictTx: vi.fn(),
  contractRateTask: vi.fn(),
  contractRefundExpired: vi.fn(),
  contractRegisterIdentityTx: vi.fn(),
  contractRejectSubmission: vi.fn(),
  contractResolveDispute: vi.fn(),
  contractSelectWorker: vi.fn(),
  contractSubmitBid: vi.fn(),
  contractSubmitPitch: vi.fn(),
  contractSubmitProof: vi.fn(),
  contractSubmitWork: vi.fn(),
  contractTransferWithAuthorization: vi.fn(),
  contractUpdateTask: vi.fn(),
  contractWithdrawDreamsRewards: vi.fn(),
  blockNumberForTx: vi.fn(),
  blockTimestampForTx: vi.fn(),
  contractProjectSettlementForTx: vi.fn(),
  resolveRegisteredAgentId: vi.fn(),
}));

import * as contract from '../../../src/services/contract';

const { classifyRelayFailure } = await import('../../../src/lib/relay-failure');
const { registerRelayedIntentHandlers } = await import('../../../src/services/intents/register');
const { dispatchRelayedIntent, getRelayedIntentBroadcaster, registerRelayedIntentHandler } =
  await import('../../../src/services/relayed-intent-registry');
const { currentRelayEnvelope, withRelayEnvelope } = await import(
  '../../../src/services/relay-envelope'
);

registerRelayedIntentHandlers();

afterAll(restoreServerEnvironment);

function mockFor(name: string) {
  return vi.mocked(
    (contract as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!
  );
}

type Row = {
  broadcastAttempts: number;
  completionAttempts: number;
  id: string;
  lastError: string | null;
  operation: string;
  payer: string | null;
  paymentTxHash: string | null;
  payload: unknown;
  relayReceiptNonce: string;
  relayValidBefore: string;
  status: string;
  txHash: string | null;
};

function intentRow(operation: string, payload: unknown, overrides: Partial<Row> = {}): Row {
  return {
    broadcastAttempts: 0,
    completionAttempts: 0,
    id: `intent-${operation}`,
    lastError: null,
    operation,
    payer: PAYER,
    paymentTxHash: null,
    payload,
    relayReceiptNonce: `0x${'cd'.repeat(32)}`,
    relayValidBefore: '1900000000',
    status: 'recorded',
    txHash: null,
    ...overrides,
  };
}

/** Minimal drizzle stand-in: enough for the claim, the status writes and the error write. */
function makeDb(row: Row) {
  return {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        const apply = () => {
          if (typeof values.status === 'string') row.status = values.status;
          if ('lastError' in values) row.lastError = values.lastError as string | null;
          if (typeof values.txHash === 'string') row.txHash = values.txHash;
          if (typeof values.broadcastAttempts === 'number') {
            row.broadcastAttempts = values.broadcastAttempts;
          }
        };
        return {
          where: () => ({
            returning: async () => {
              if (row.status !== 'recorded' && row.status !== 'broadcast') return [];
              row.broadcastAttempts += 1;
              apply();
              return [{ ...row }];
            },
            then: (onfulfilled?: (value: undefined) => unknown) => {
              apply();
              return Promise.resolve(undefined).then(onfulfilled);
            },
          }),
        };
      },
    }),
  };
}

describe.each(OPERATIONS)(
  'replaying $operation, which ADR-0054 made safe to replay',
  ({ args, contractFn, operation, payload, revert }) => {
    beforeEach(() => {
      vi.clearAllMocks();
      registerRelayedIntentHandlers();
    });

    // Verifies: ADR-0050
    it('reconstructs the same call from the persisted payload that the request path made', async () => {
      // The router builds one payload object and uses it for both the intent row and its own
      // `send`, so this equality is the same equality the request relies on. Everything the call
      // needs is on the row: nothing is re-derived from a task row a confirmed first attempt may
      // already have moved -- `currentReward` above being the field that would.
      mockFor(contractFn).mockResolvedValue('0xreplay');
      const broadcast = getRelayedIntentBroadcaster(operation)!;

      const hash = await broadcast({
        db: {} as never,
        intent: intentRow(operation, payload) as never,
      });

      expect(mockFor(contractFn)).toHaveBeenCalledWith(...args);
      expect(hash).toBe('0xreplay');
    });

    // Verifies: ADR-0050
    it('reads nothing from the database while doing it', async () => {
      mockFor(contractFn).mockResolvedValue('0xreplay');
      const broadcast = getRelayedIntentBroadcaster(operation)!;
      const hostileDb = new Proxy(
        {},
        {
          get() {
            throw new Error('a broadcaster must not read the database');
          },
        }
      );

      await expect(
        broadcast({ db: hostileDb as never, intent: intentRow(operation, payload) as never })
      ).resolves.toBe('0xreplay');
    });

    // Verifies: ADR-0050
    it('replays the stored relay envelope rather than minting a fresh one', async () => {
      // The deadline is the only real bound on retrying, and it bounds nothing unless it is the
      // one fixed when the intent was recorded. `dispatchRelayedIntent` binds the stored
      // envelope around the broadcaster, so this operation inherits the rule rather than
      // restating it -- what is asserted is that it does not escape it.
      mockFor(contractFn).mockImplementation(async () => {
        expect(currentRelayEnvelope()).toEqual({
          receiptNonce: `0x${'cd'.repeat(32)}`,
          validBefore: 1_900_000_000n,
        });
        return '0xreplay';
      });
      const row = intentRow(operation, payload);
      const db = makeDb(row);

      const outcome = await dispatchRelayedIntent({ db: db as never, intent: row as never });

      expect(outcome).toBe('broadcast');
      // A regenerated envelope inside the broadcaster would have made the expectation above
      // fail; asserting the call happened at all stops that passing vacuously.
      expect(mockFor(contractFn)).toHaveBeenCalledOnce();
    });

    // Verifies: ADR-0054
    it(`is refused by the chain on a second landing with ${revert}`, async () => {
      // Not "unlikely to be sent twice" -- refused. This is the guard the registration states,
      // and it is what separates these two from every payload trick: the money the replay would
      // move is unwound by the revert taking the whole transaction with it.
      const complete = vi.fn();
      registerRelayedIntentHandler(operation as never, {
        broadcast: getRelayedIntentBroadcaster(operation)!,
        complete,
      });
      mockFor(contractFn).mockRejectedValue(new Error(`Contract call rejected: ${revert}`));
      const row = intentRow(operation, payload);
      const db = makeDb(row);

      const outcome = await dispatchRelayedIntent({ db: db as never, intent: row as never });

      expect(outcome).toBe('failed');
      expect(row.status).toBe('failed');
      expect(row.lastError).toContain(revert);
      // The completion handler must not run. A reverted replay moved nothing, and the first
      // attempt's completion already wrote the off-chain half -- running it again here would be
      // the database asserting an outcome this transaction did not produce (ADR-0050 point 1).
      expect(complete).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0054
    it('does not leave a paid replay retrying after that revert', async () => {
      // The wrinkle worth checking. A paid intent must not be marked failed here -- settlement
      // alone decides a payment is orphaned (ADR-0048) -- so the terminal signal is the spent
      // retry budget instead, which is what stops the worker re-asking a question whose answer
      // cannot change and leaves the row exactly where the abandoned sweep will find it.
      registerRelayedIntentHandler(operation as never, {
        broadcast: getRelayedIntentBroadcaster(operation)!,
        complete: vi.fn(),
      });
      mockFor(contractFn).mockRejectedValue(new Error(`Contract call rejected: ${revert}`));
      const row = intentRow(operation, payload, { paymentTxHash: PAYMENT_TX });
      const db = makeDb(row);

      const outcome = await dispatchRelayedIntent({ db: db as never, intent: row as never });

      expect(outcome).toBe('failed');
      expect(row.status).toBe('recorded');
      expect(row.lastError).toContain(revert);
    });

    // Verifies: ADR-0054
    it('classifies that revert as deterministic rather than worth another attempt', () => {
      // The link between the two assertions above and reality. If this revert reached
      // classification undecoded it would read as "unknown revert", which is deliberately
      // transient, and the worker would hand the intent straight back -- ADR-0047's unbounded
      // loop, re-entered through a missing entry in KNOWN_ERRORS.
      expect(classifyRelayFailure(new Error(`Contract call rejected: ${revert}`))).toBe(
        'deterministic'
      );
    });
  }
);

describe("the revert vocabulary those guards depend on being decodable", () => {
  /**
   * The KNOWN_ERRORS map, read out of the source and keyed by selector.
   *
   * Read rather than imported because the map is module-private. What matters is not that the
   * names appear but that they appear under the *right* four bytes: a wrong selector is silently
   * inert -- it never matches, the revert decodes as "unknown revert", and the guard degrades
   * into a retry loop with nothing failing to say so.
   */
  function knownErrors(): Record<string, string> {
    const path = join(process.cwd(), 'src', 'services', 'contract.ts');
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const found: Record<string, string> = {};

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'KNOWN_ERRORS' &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          if (!ts.isStringLiteral(property.name)) continue;
          if (!ts.isStringLiteral(property.initializer)) continue;
          found[property.name.text.toLowerCase()] = property.initializer.text;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    return found;
  }

  const errors = knownErrors();

  it('found the map it is checking', () => {
    // Guards the guard: a parse returning nothing would make both assertions below vacuous.
    expect(Object.keys(errors).length).toBeGreaterThan(50);
  });

  it.each(['TaskAlreadyRefunded', 'NoRewardChange'])(
    'decodes %s under its own selector',
    (name) => {
      // Computed rather than pasted, because the selector is the part a human gets wrong.
      const selector = toFunctionSelector(`function ${name}()`).toLowerCase();

      expect(errors[selector]).toBe(name);
    }
  );
});
