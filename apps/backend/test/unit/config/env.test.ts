import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getServerConfig } from '../../../src/config/env';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/taskmarket',
  BASE_RPC_URL: 'https://example-rpc.local',
  CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
  FORWARDER_ADDRESS: '0x3333333333333333333333333333333333333333',
  USDC_TOKEN_ADDRESS: '0x2222222222222222222222222222222222222222',
  SERVER_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
};

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
