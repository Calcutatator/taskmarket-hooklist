import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_SUBMISSION_ALLOWANCE,
  HARD_SUBMISSION_CEILING,
  getFreeSubmissionAllowance,
  getHardSubmissionCeiling,
} from '../../../src/config/payments';

// getServerConfig() re-parses process.env on every call (config/env.ts), so mutating
// process.env directly (same approach as config/env.test.ts) exercises the real schema
// rather than a mock of it.
const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/taskmarket',
  BASE_RPC_URL: 'https://example-rpc.local',
  CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
  FORWARDER_ADDRESS: '0x3333333333333333333333333333333333333333',
  USDC_TOKEN_ADDRESS: '0x2222222222222222222222222222222222222222',
  SERVER_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
};

describe('getFreeSubmissionAllowance (RFC-0006 Tier 1 env override)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.SUBMISSION_FREE_ALLOWANCE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('falls back to the FREE_SUBMISSION_ALLOWANCE default when unset', () => {
    expect(getFreeSubmissionAllowance()).toBe(FREE_SUBMISSION_ALLOWANCE);
  });

  it('honors SUBMISSION_FREE_ALLOWANCE when set -- e.g. the smoke sandbox raising it to 1000', () => {
    process.env.SUBMISSION_FREE_ALLOWANCE = '1000';
    expect(getFreeSubmissionAllowance()).toBe(1000);
  });

  it('coerces a numeric string override to a number', () => {
    process.env.SUBMISSION_FREE_ALLOWANCE = '25';
    expect(getFreeSubmissionAllowance()).toBe(25);
    expect(typeof getFreeSubmissionAllowance()).toBe('number');
  });
});

describe('getHardSubmissionCeiling (RFC-0006 Tier 2 env override, ADR-0037)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.HARD_SUBMISSION_CEILING;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('falls back to the HARD_SUBMISSION_CEILING default (100) when unset', () => {
    expect(getHardSubmissionCeiling()).toBe(HARD_SUBMISSION_CEILING);
    expect(HARD_SUBMISSION_CEILING).toBe(100);
  });

  it('honors a HARD_SUBMISSION_CEILING override -- e.g. a smoke test lowering it to 7', () => {
    process.env.HARD_SUBMISSION_CEILING = '7';
    expect(getHardSubmissionCeiling()).toBe(7);
  });

  it('coerces a numeric string override to a number', () => {
    process.env.HARD_SUBMISSION_CEILING = '12';
    expect(getHardSubmissionCeiling()).toBe(12);
    expect(typeof getHardSubmissionCeiling()).toBe('number');
  });
});
