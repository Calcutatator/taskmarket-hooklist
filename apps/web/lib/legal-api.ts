import {
  LegalAcceptanceResponseSchema,
  LegalBundleSchema,
  LegalStatusResponseSchema,
  LegalWebAcceptanceInputSchema,
  type LegalAcceptanceResponse,
  type LegalBundle,
  type LegalStatusResponse,
  type LegalWebAcceptanceInput,
} from '@taskmarket/shared';

import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getLegalReceiptHeaders } from '@/lib/legal-receipt';

export async function getCurrentLegalBundle(): Promise<LegalBundle> {
  const response = await fetch(`${getBrowserApiBaseUrl()}/api/legal/current`, {
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Legal bundle check failed (${response.status})`);
  return LegalBundleSchema.parse(await response.json());
}

export async function getLegalStatus(accessToken?: string | null): Promise<LegalStatusResponse> {
  const response = await fetch(`${getBrowserApiBaseUrl()}/api/legal/status`, {
    headers: {
      ...getLegalReceiptHeaders(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Legal status check failed (${response.status})`);
  return LegalStatusResponseSchema.parse(await response.json());
}

export async function acceptWebLegalBundle(
  input: LegalWebAcceptanceInput,
  accessToken: string
): Promise<LegalAcceptanceResponse> {
  const response = await fetch(`${getBrowserApiBaseUrl()}/api/legal/accept/web`, {
    body: JSON.stringify(LegalWebAcceptanceInputSchema.parse(input)),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    redirect: 'error',
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? `Acceptance failed (${response.status})`);
  }
  return LegalAcceptanceResponseSchema.parse(body);
}
