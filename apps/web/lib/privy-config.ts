const PLACEHOLDER_PRIVY_APP_ID = '0000000000000000000000000';

type PrivyEnv = Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_PRIVY_APP_ID' | 'NEXT_PUBLIC_PRIVY_CLIENT_ID'>;

function getPrivyEnvValue(env: PrivyEnv | undefined, key: keyof PrivyEnv, fallback?: string) {
  return (env ? env[key] : fallback)?.trim();
}

export function isPrivyConfigured(env?: PrivyEnv) {
  return Boolean(
    getPrivyEnvValue(env, 'NEXT_PUBLIC_PRIVY_APP_ID', process.env.NEXT_PUBLIC_PRIVY_APP_ID)
  );
}

export function getPrivyAppId(env?: PrivyEnv) {
  return (
    getPrivyEnvValue(env, 'NEXT_PUBLIC_PRIVY_APP_ID', process.env.NEXT_PUBLIC_PRIVY_APP_ID) ||
    PLACEHOLDER_PRIVY_APP_ID
  );
}

export function getPrivyClientId(env?: PrivyEnv) {
  return getPrivyEnvValue(
    env,
    'NEXT_PUBLIC_PRIVY_CLIENT_ID',
    process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID
  );
}
