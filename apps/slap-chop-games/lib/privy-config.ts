type PrivyEnvironment = Pick<
  NodeJS.ProcessEnv,
  'NEXT_PUBLIC_PRIVY_APP_ID' | 'NEXT_PUBLIC_PRIVY_CLIENT_ID'
>;

function configuredValue(
  environment: PrivyEnvironment | undefined,
  key: keyof PrivyEnvironment,
  fallback?: string
): string | undefined {
  const value = (environment ? environment[key] : fallback)?.trim();
  return value || undefined;
}

export function isSlapChopPrivyConfigured(environment?: PrivyEnvironment): boolean {
  return Boolean(
    configuredValue(environment, 'NEXT_PUBLIC_PRIVY_APP_ID', process.env.NEXT_PUBLIC_PRIVY_APP_ID)
  );
}

export function getSlapChopPrivyAppId(environment?: PrivyEnvironment): string | undefined {
  return configuredValue(
    environment,
    'NEXT_PUBLIC_PRIVY_APP_ID',
    process.env.NEXT_PUBLIC_PRIVY_APP_ID
  );
}

export function getSlapChopPrivyClientId(environment?: PrivyEnvironment): string | undefined {
  return configuredValue(
    environment,
    'NEXT_PUBLIC_PRIVY_CLIENT_ID',
    process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID
  );
}
