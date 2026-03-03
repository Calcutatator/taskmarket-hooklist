import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getServerConfig } from '../../../src/config/env';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/taskmarket',
  BASE_RPC_URL: 'https://example-rpc.local',
  CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
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
