import { PrivyClient, type VerifyAccessTokenResponse } from '@privy-io/node';

import { getServerConfig } from '../config/env';

let cachedClient: PrivyClient | undefined;
let cachedKey: string | undefined;

function getPrivyClient(): PrivyClient {
  const config = getServerConfig();
  if (!config.PRIVY_APP_ID || !config.PRIVY_APP_SECRET) {
    throw new Error('Privy server authentication is not configured');
  }

  const key = [
    config.PRIVY_APP_ID,
    config.PRIVY_APP_SECRET,
    config.PRIVY_JWT_VERIFICATION_KEY ?? '',
  ].join(':');
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new PrivyClient({
      appId: config.PRIVY_APP_ID,
      appSecret: config.PRIVY_APP_SECRET,
      ...(config.PRIVY_JWT_VERIFICATION_KEY
        ? { jwtVerificationKey: config.PRIVY_JWT_VERIFICATION_KEY }
        : {}),
    });
    cachedKey = key;
  }

  return cachedClient;
}

export function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export async function verifyPrivyAccessToken(
  authorization: string | undefined
): Promise<VerifyAccessTokenResponse> {
  const token = readBearerToken(authorization);
  if (!token) {
    throw new Error('A Privy bearer token is required');
  }

  return getPrivyClient().utils().auth().verifyAccessToken(token);
}

export function _resetPrivyClientForTests(): void {
  cachedClient = undefined;
  cachedKey = undefined;
}
