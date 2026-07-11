import { vi } from 'vitest';

const serverEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://taskmarket:taskmarket@127.0.0.1:5432/taskmarket_test',
  BASE_RPC_URL: 'http://127.0.0.1:8545',
  CONTRACT_ADDRESS: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  FORWARDER_ADDRESS: '0x0000000000000000000000000000000000000001',
  USDC_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000002',
  SERVER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
} as const;

export function stubServerEnvironment(): () => void {
  for (const [name, value] of Object.entries(serverEnvironment)) {
    vi.stubEnv(name, value);
  }

  return () => vi.unstubAllEnvs();
}
