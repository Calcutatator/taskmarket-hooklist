// Implements: ADR-0092
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import type { X402PolicyAuthorization } from './x402-policy.js';

export type X402PaymentState =
  | 'reserved'
  | 'approval_pending'
  | 'ready'
  | 'dispatched'
  | 'settled'
  | 'failed_before_dispatch'
  | 'unknown'
  | 'expired_unspent'
  | 'settled_amount_unknown'
  | 'manually_resolved';

export interface X402PaymentRecord {
  id: string;
  state: X402PaymentState;
  createdAt: string;
  updatedAt: string;
  ruleId: string;
  origin: string;
  pathname: string;
  requestHash: string;
  method: 'GET' | 'POST';
  payer: string;
  scheme: 'exact' | 'upto';
  network: string;
  asset: string;
  payTo: string;
  authorizedAmount: string;
  settledAmount?: string;
  nonce?: string;
  authorizationKind?: 'eip3009' | 'permit2';
  authorizationExpiresAt?: string;
  transaction?: string;
  approvalMode?: string;
  approvalPreviousAllowance?: string;
  approvalTargetAllowance?: string;
  approvalTransaction?: string;
  approvalGasCostWei?: string;
  error?: string;
  resolutionNote?: string;
}

interface X402JournalEvent extends X402PaymentRecord {
  eventAt: string;
}

export interface X402ReservationInput {
  authorization: X402PolicyAuthorization;
  url: URL;
  method: 'GET' | 'POST';
  requestHash: string;
  payer: string;
  now?: Date;
}

const COUNT_MAXIMUM_STATES = new Set<X402PaymentState>([
  'reserved',
  'approval_pending',
  'ready',
  'dispatched',
  'unknown',
  'settled_amount_unknown',
]);

const ALLOWED_TRANSITIONS: Record<X402PaymentState, ReadonlySet<X402PaymentState>> = {
  reserved: new Set(['approval_pending', 'ready', 'failed_before_dispatch']),
  approval_pending: new Set(['reserved', 'failed_before_dispatch']),
  ready: new Set(['dispatched', 'failed_before_dispatch', 'unknown']),
  dispatched: new Set(['settled', 'unknown', 'expired_unspent', 'settled_amount_unknown']),
  settled: new Set(),
  failed_before_dispatch: new Set(),
  unknown: new Set([
    'settled',
    'unknown',
    'expired_unspent',
    'settled_amount_unknown',
    'manually_resolved',
  ]),
  expired_unspent: new Set(),
  settled_amount_unknown: new Set([
    'settled',
    'expired_unspent',
    'settled_amount_unknown',
    'manually_resolved',
  ]),
  manually_resolved: new Set(),
};

export function getX402JournalPath(): string {
  return (
    process.env['TASKMARKET_X402_JOURNAL_PATH'] ??
    path.join(os.homedir(), '.taskmarket', 'x402-payments.jsonl')
  );
}

async function readJournalEvents(journalPath: string): Promise<X402JournalEvent[]> {
  let raw: string;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(journalPath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new Error(`x402 payment journal must be a regular file: ${journalPath}`);
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`x402 payment journal must be accessible only by its owner: ${journalPath}`);
    }
    raw = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as X402JournalEvent;
      } catch (error) {
        throw new Error(
          `Corrupt x402 payment journal at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
}

function latestRecords(events: X402JournalEvent[]): Map<string, X402PaymentRecord> {
  const records = new Map<string, X402PaymentRecord>();
  for (const event of events) {
    const record = { ...event } as Partial<X402JournalEvent>;
    delete record.eventAt;
    records.set(event.id, record as X402PaymentRecord);
  }
  return records;
}

async function appendEvent(journalPath: string, record: X402PaymentRecord): Promise<void> {
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  const event: X402JournalEvent = { ...record, eventAt: new Date().toISOString() };
  await fs.appendFile(journalPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(journalPath, 0o600);
}

async function acquireLock(lockPath: string): Promise<fs.FileHandle> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      );
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lockPath);
        let ownerIsAlive = true;
        try {
          const owner = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { pid?: unknown };
          if (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid)) {
            ownerIsAlive = true;
          } else {
            try {
              process.kill(owner.pid, 0);
            } catch (ownerError) {
              ownerIsAlive = (ownerError as NodeJS.ErrnoException).code === 'EPERM';
            }
          }
        } catch {
          ownerIsAlive = true;
        }
        if (!ownerIsAlive && Date.now() - stat.mtimeMs > 30_000) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline)
        throw new Error('Timed out waiting for x402 payment journal lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withJournalLock<T>(journalPath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${journalPath}.lock`;
  const handle = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function amountCounted(record: X402PaymentRecord): bigint {
  if (record.state === 'settled' || record.state === 'manually_resolved') {
    return BigInt(record.settledAmount ?? record.authorizedAmount);
  }
  if (COUNT_MAXIMUM_STATES.has(record.state)) return BigInt(record.authorizedAmount);
  return 0n;
}

export async function reserveX402Payment(
  input: X402ReservationInput,
  journalPath: string = getX402JournalPath()
): Promise<X402PaymentRecord> {
  return withJournalLock(journalPath, async () => {
    const events = await readJournalEvents(journalPath);
    const records = latestRecords(events);
    const { authorization } = input;
    const windowStartedAt = new Date(authorization.windowStartedAt).getTime();
    let used = 0n;
    for (const record of records.values()) {
      if (
        record.ruleId === authorization.rule.id &&
        record.network === authorization.requirement.network &&
        record.asset.toLowerCase() === authorization.requirement.asset.toLowerCase() &&
        (COUNT_MAXIMUM_STATES.has(record.state) ||
          new Date(record.createdAt).getTime() >= windowStartedAt)
      ) {
        used += amountCounted(record);
      }
    }
    const requested = BigInt(authorization.requirement.amount);
    const maximum = BigInt(authorization.payment.spendWindow.max);
    if (used + requested > maximum) {
      throw new Error(
        `x402 spending window exceeded for rule '${authorization.rule.id}': ${used} used + ${requested} requested > ${maximum}`
      );
    }
    const now = (input.now ?? new Date()).toISOString();
    const record: X402PaymentRecord = {
      id: randomUUID(),
      state: 'reserved',
      createdAt: now,
      updatedAt: now,
      ruleId: authorization.rule.id,
      origin: input.url.origin,
      pathname: input.url.pathname,
      requestHash: input.requestHash,
      method: input.method,
      payer: input.payer.toLowerCase(),
      scheme: authorization.requirement.scheme as 'exact' | 'upto',
      network: authorization.requirement.network,
      asset: authorization.requirement.asset.toLowerCase(),
      payTo: authorization.requirement.payTo.toLowerCase(),
      authorizedAmount: authorization.requirement.amount,
    };
    await appendEvent(journalPath, record);
    return record;
  });
}

export async function transitionX402Payment(
  id: string,
  update: Partial<
    Pick<
      X402PaymentRecord,
      | 'state'
      | 'settledAmount'
      | 'nonce'
      | 'authorizationKind'
      | 'authorizationExpiresAt'
      | 'transaction'
      | 'approvalMode'
      | 'approvalPreviousAllowance'
      | 'approvalTargetAllowance'
      | 'approvalTransaction'
      | 'approvalGasCostWei'
      | 'error'
      | 'resolutionNote'
    >
  > & { state: X402PaymentState },
  journalPath: string = getX402JournalPath()
): Promise<X402PaymentRecord> {
  return withJournalLock(journalPath, async () => {
    const records = latestRecords(await readJournalEvents(journalPath));
    const current = records.get(id);
    if (!current) throw new Error(`x402 payment '${id}' was not found`);
    if (!ALLOWED_TRANSITIONS[current.state].has(update.state)) {
      throw new Error(
        `x402 payment '${id}' cannot transition from '${current.state}' to '${update.state}'`
      );
    }
    if (update.settledAmount !== undefined) {
      if (!/^\d+$/.test(update.settledAmount)) throw new Error('settled amount must be an integer');
      if (BigInt(update.settledAmount) > BigInt(current.authorizedAmount)) {
        throw new Error('settled amount exceeds authorized maximum');
      }
    }
    const next: X402PaymentRecord = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    await appendEvent(journalPath, next);
    return next;
  });
}

export async function listX402Payments(
  options: { state?: X402PaymentState } = {},
  journalPath: string = getX402JournalPath()
): Promise<X402PaymentRecord[]> {
  const records = [...latestRecords(await readJournalEvents(journalPath)).values()];
  return records
    .filter((record) => !options.state || record.state === options.state)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getX402Payment(
  id: string,
  journalPath: string = getX402JournalPath()
): Promise<X402PaymentRecord> {
  const record = latestRecords(await readJournalEvents(journalPath)).get(id);
  if (!record) throw new Error(`x402 payment '${id}' was not found`);
  return record;
}

export async function resolveX402PaymentManually(
  input: {
    id: string;
    settledAmount: string;
    transaction?: string;
    note: string;
  },
  journalPath: string = getX402JournalPath()
): Promise<X402PaymentRecord> {
  if (!input.note.trim()) throw new Error('manual resolution requires a non-empty note');
  const current = await getX402Payment(input.id, journalPath);
  if (!['dispatched', 'unknown', 'settled_amount_unknown'].includes(current.state)) {
    throw new Error(
      `x402 payment '${input.id}' in state '${current.state}' cannot be resolved manually`
    );
  }
  if (input.transaction && !/^0x[a-fA-F0-9]{64}$/.test(input.transaction)) {
    throw new Error('manual resolution transaction must be a 32-byte hash');
  }
  return transitionX402Payment(
    input.id,
    {
      state: 'manually_resolved',
      settledAmount: input.settledAmount,
      transaction: input.transaction,
      resolutionNote: input.note.trim(),
    },
    journalPath
  );
}
