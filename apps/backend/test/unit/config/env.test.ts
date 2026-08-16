import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEvaluatorSmokePrivateKeys,
  getOptionalDatabaseUrl,
  getServerConfig,
} from '../../../src/config/env';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/taskmarket',
  BASE_RPC_URL: 'https://example-rpc.local',
  CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
  FORWARDER_ADDRESS: '0x3333333333333333333333333333333333333333',
  USDC_TOKEN_ADDRESS: '0x2222222222222222222222222222222222222222',
  SERVER_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
};

describe('getOptionalDatabaseUrl', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when integration PostgreSQL is not provisioned', () => {
    delete process.env.DATABASE_URL;

    expect(getOptionalDatabaseUrl()).toBeUndefined();
  });

  it('normalizes a configured PostgreSQL URL', () => {
    process.env.DATABASE_URL = '  postgresql://taskmarket:taskmarket@localhost:5432/test  ';

    expect(getOptionalDatabaseUrl()).toBe('postgresql://taskmarket:taskmarket@localhost:5432/test');
  });

  it('rejects a non-PostgreSQL URL', () => {
    process.env.DATABASE_URL = 'https://example.com/database';

    expect(() => getOptionalDatabaseUrl()).toThrow(
      'DATABASE_URL must use the postgres or postgresql protocol'
    );
  });
});

describe('getEvaluatorSmokePrivateKeys', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns the distinct evaluator smoke actor keys', () => {
    process.env.EVALUATOR_PRIVATE_KEY =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.WORKER_B_PRIVATE_KEY =
      '0x2222222222222222222222222222222222222222222222222222222222222222';

    expect(getEvaluatorSmokePrivateKeys()).toEqual({
      evaluatorPrivateKey:
        '0x1111111111111111111111111111111111111111111111111111111111111111',
      resolverPrivateKey:
        '0x2222222222222222222222222222222222222222222222222222222222222222',
    });
  });

  it('requires both evaluator smoke actor keys', () => {
    process.env.EVALUATOR_PRIVATE_KEY =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    delete process.env.WORKER_B_PRIVATE_KEY;

    expect(() => getEvaluatorSmokePrivateKeys()).toThrow(
      'EVALUATOR_PRIVATE_KEY and WORKER_B_PRIVATE_KEY are required'
    );
  });

  it('rejects malformed evaluator smoke actor keys', () => {
    process.env.EVALUATOR_PRIVATE_KEY = 'not-a-private-key';
    process.env.WORKER_B_PRIVATE_KEY =
      '0x2222222222222222222222222222222222222222222222222222222222222222';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process exited with ${code}`);
    });

    expect(() => getEvaluatorSmokePrivateKeys()).toThrow('process exited with 1');
  });
});

describe('getServerConfig XMTP env parsing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('parses XMTP_ENABLED=false as false', () => {
    process.env.XMTP_ENABLED = 'false';

    const config = getServerConfig();

    expect(config.XMTP_ENABLED).toBe(false);
  });

  it('parses XMTP_ENABLED=true as true', () => {
    process.env.XMTP_ENABLED = 'true';

    const config = getServerConfig();

    expect(config.XMTP_ENABLED).toBe(true);
  });
});

describe('getServerConfig legal enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
      LEGAL_ENFORCEMENT_ENABLED: 'false',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('parses an explicit false value without requiring Privy credentials', () => {
    const config = getServerConfig();

    expect(config.LEGAL_ENFORCEMENT_ENABLED).toBe(false);
  });

  it('parses the trusted reverse-proxy hop count used for acceptance IP evidence', () => {
    process.env.TRUST_PROXY_HOPS = '2';

    expect(getServerConfig().TRUST_PROXY_HOPS).toBe(2);
  });

  it('refuses activation while the checked-in legal bundle is a draft', () => {
    process.env.LEGAL_ENFORCEMENT_ENABLED = 'true';
    process.env.PRIVY_APP_ID = 'privy-app-id';
    process.env.PRIVY_APP_SECRET = 'privy-app-secret';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process exited with ${code}`);
    });

    expect(() => getServerConfig()).toThrow('process exited with 1');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        LEGAL_ENFORCEMENT_ENABLED: {
          _errors: [expect.stringContaining('LEGAL_ENFORCEMENT_ENABLED requires final legal copy')],
        },
      })
    );
  });

  it('refuses activation when the web and backend Privy app ids differ', () => {
    process.env.LEGAL_ENFORCEMENT_ENABLED = 'true';
    process.env.PRIVY_APP_ID = 'backend-privy-app';
    process.env.PRIVY_APP_SECRET = 'privy-app-secret';
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'web-privy-app';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process exited with ${code}`);
    });

    expect(() => getServerConfig()).toThrow('process exited with 1');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        NEXT_PUBLIC_PRIVY_APP_ID: {
          _errors: [expect.stringContaining('must match PRIVY_APP_ID')],
        },
      })
    );
  });
});

describe('getServerConfig official Task Drop owner parsing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
    delete process.env.OFFICIAL_TASK_DROP_OWNER_ADDRESSES;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('defaults to an empty owner allowlist', () => {
    expect(getServerConfig().OFFICIAL_TASK_DROP_OWNER_ADDRESSES).toEqual([]);
  });

  it('normalizes and deduplicates comma-separated owner addresses', () => {
    process.env.OFFICIAL_TASK_DROP_OWNER_ADDRESSES =
      ' 0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD,0xabcdefabcdefabcdefabcdefabcdefabcdefabcd,0x2222222222222222222222222222222222222222 ';

    expect(getServerConfig().OFFICIAL_TASK_DROP_OWNER_ADDRESSES).toEqual([
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      '0x2222222222222222222222222222222222222222',
    ]);
  });

  it('rejects an invalid official owner address', () => {
    process.env.OFFICIAL_TASK_DROP_OWNER_ADDRESSES = 'not-an-address';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process exited');
    }) as never);

    expect(() => getServerConfig()).toThrow('process exited');
    expect(JSON.stringify(errorSpy.mock.calls)).toContain(
      'Invalid official Task Drop owner address'
    );
  });
});

describe('getServerConfig Slap-Chop curator allowlist parsing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
    delete process.env.SLAP_CHOP_CURATOR_PRIVY_USER_IDS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('fails closed with no configured curator identities', () => {
    expect(getServerConfig().SLAP_CHOP_CURATOR_PRIVY_USER_IDS).toEqual([]);
  });

  it('trims and deduplicates exact Privy user IDs', () => {
    process.env.PRIVY_APP_ID = 'privy-app-id';
    process.env.PRIVY_APP_SECRET = 'privy-app-secret';
    process.env.SLAP_CHOP_CURATOR_PRIVY_USER_IDS =
      ' did:privy:curator_1,did:privy:curator_1 , did:privy:curator-2 ';

    expect(getServerConfig().SLAP_CHOP_CURATOR_PRIVY_USER_IDS).toEqual([
      'did:privy:curator_1',
      'did:privy:curator-2',
    ]);
  });

  it('rejects malformed curator IDs', () => {
    process.env.PRIVY_APP_ID = 'privy-app-id';
    process.env.PRIVY_APP_SECRET = 'privy-app-secret';
    process.env.SLAP_CHOP_CURATOR_PRIVY_USER_IDS = 'not-a-privy-id';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process exited');
    }) as never);

    expect(() => getServerConfig()).toThrow('process exited');
  });

  it('refuses a configured allowlist without server Privy credentials', () => {
    process.env.SLAP_CHOP_CURATOR_PRIVY_USER_IDS = 'did:privy:curator_1';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process exited');
    }) as never);

    expect(() => getServerConfig()).toThrow('process exited');
  });
});

describe('getServerConfig DREAMS_HOOK_SEED_BLOCK env parsing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
    delete process.env.DREAMS_HOOK_SEED_BLOCK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to 0 when unset', () => {
    const config = getServerConfig();

    expect(config.DREAMS_HOOK_SEED_BLOCK).toBe(0);
  });

  it('coerces a numeric string to a number', () => {
    process.env.DREAMS_HOOK_SEED_BLOCK = '12345678';

    const config = getServerConfig();

    expect(config.DREAMS_HOOK_SEED_BLOCK).toBe(12345678);
  });
});

describe('getServerConfig task award backfill env parsing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
    delete process.env.TASK_AWARDS_BACKFILL_FROM_BLOCK;
    delete process.env.TASK_AWARDS_BACKFILL_TO_BLOCK;
    delete process.env.TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('defaults optional bounds to undefined and checkpoint reuse to enabled', () => {
    const config = getServerConfig();

    expect(config.TASK_AWARDS_BACKFILL_FROM_BLOCK).toBeUndefined();
    expect(config.TASK_AWARDS_BACKFILL_TO_BLOCK).toBeUndefined();
    expect(config.TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT).toBe(false);
  });

  it('parses explicit block bounds and checkpoint override', () => {
    process.env.TASK_AWARDS_BACKFILL_FROM_BLOCK = '12345678';
    process.env.TASK_AWARDS_BACKFILL_TO_BLOCK = '12345999';
    process.env.TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT = 'true';

    const config = getServerConfig();

    expect(config.TASK_AWARDS_BACKFILL_FROM_BLOCK).toBe(12345678);
    expect(config.TASK_AWARDS_BACKFILL_TO_BLOCK).toBe(12345999);
    expect(config.TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT).toBe(true);
  });

  it.each([
    ['TASK_AWARDS_BACKFILL_FROM_BLOCK', '-1'],
    ['TASK_AWARDS_BACKFILL_TO_BLOCK', '1.5'],
    ['TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT', 'yes'],
  ])('rejects invalid %s values', (name, value) => {
    process.env[name] = value;
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    getServerConfig();

    expect(exit).toHaveBeenCalledWith(1);
  });
});

// Verifies: ADR-0090
describe('getServerConfig Slap-Chop ranking mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.SLAP_CHOP_RANKING_MODE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('defaults to Hot ranking and permits newest-first rollback only', () => {
    expect(getServerConfig().SLAP_CHOP_RANKING_MODE).toBe('hot');

    process.env.SLAP_CHOP_RANKING_MODE = 'new';
    expect(getServerConfig().SLAP_CHOP_RANKING_MODE).toBe('new');
  });

  it('rejects an unapproved ranking mode', () => {
    process.env.SLAP_CHOP_RANKING_MODE = 'best';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process exited with ${code}`);
    });

    expect(() => getServerConfig()).toThrow('process exited with 1');
  });
});

// Verifies: ADR-0051
describe('getServerConfig replacement gas policy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('defaults to the Base-tuned curve, with the opening bid preserving the previous 2x', () => {
    const config = getServerConfig();

    expect(config.REPLACEMENT_GAS_FIRST_BUMP_PCT).toBe(200);
    expect(config.REPLACEMENT_GAS_ESCALATION_PCT).toBe(150);
    expect(config.REPLACEMENT_GAS_MAX_MULTIPLE).toBe(10);
    expect(config.REPLACEMENT_GAS_MAX_FEE_WEI).toBeUndefined();
  });

  it('refuses an escalation percentage the network would reject as no bump at all', () => {
    // Providers enforce a minimum bump of around 10%, so anything near it is the status quo's
    // bug expressed as a configuration value. The schema refuses it rather than trusting the
    // operator to know.
    process.env.REPLACEMENT_GAS_ESCALATION_PCT = '105';

    expect(() => getServerConfig()).toThrow();
  });

  it('refuses a cap that leaves no room above the original fee', () => {
    process.env.REPLACEMENT_GAS_MAX_MULTIPLE = '1';

    expect(() => getServerConfig()).toThrow();
  });

  it.each(['', '   '])(
    'reads a blank absolute ceiling as unset rather than refusing to boot: %j',
    (value) => {
      // `.optional()` covers a variable that is absent from the environment, not one present
      // and empty -- and leaving a key blank in a `.env` file is the ordinary way an operator
      // says "unset". Without normalising it first, the digits-only rule rejects `''` and the
      // process exits at boot over a field nobody meant to configure.
      process.env.REPLACEMENT_GAS_MAX_FEE_WEI = value;

      expect(getServerConfig().REPLACEMENT_GAS_MAX_FEE_WEI).toBeUndefined();
    }
  );

  it.each(['1e18', '0x10', '1.5', '-1', '0', '1 000'])(
    'still refuses a non-empty ceiling that is not plain digits: %j',
    (value) => {
      // The digits-only rule is the whole reason this field is a string: a per-gas ceiling in
      // wei is exactly the quantity that exceeds Number.MAX_SAFE_INTEGER, and every form here
      // is one Number would have accepted and quietly mangled. Forgiving the empty case must
      // not forgive any of these.
      process.env.REPLACEMENT_GAS_MAX_FEE_WEI = value;

      expect(() => getServerConfig()).toThrow();
    }
  );

  it('parses a real ceiling well past the float-safe range without losing digits', () => {
    process.env.REPLACEMENT_GAS_MAX_FEE_WEI = '90071992547409910';

    expect(getServerConfig().REPLACEMENT_GAS_MAX_FEE_WEI).toBe(90071992547409910n);
  });
});
