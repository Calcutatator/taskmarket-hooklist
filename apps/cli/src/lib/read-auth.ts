import {
  buildReadAuthMessage,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '@taskmarket/shared';
import { createWalletAccountFromKeystore } from './signer.js';
import { loadKeystore } from './keystore.js';

export type ReadAuth = {
  walletAddress: string;
  headers: Record<string, string>;
};

/**
 * Signs the Phase 2 read-auth message (ADR-0016) proving ownership of the
 * local keystore's wallet address, for reads whose response depends on
 * caller identity (non-public submissionVisibility, unlisted taskVisibility,
 * etc.). Never throws.
 *
 * Returns null only when there's no keystore at all -- callers that also need
 * a default `--address` (e.g. `task my-submissions`) have nothing to fall
 * back to in that case. If the keystore loads but signing itself fails, the
 * wallet address is still returned with empty `headers`, so callers can fall
 * back to the anonymous view for THAT request while still defaulting
 * `--address` to the caller's own wallet.
 */
export async function signReadAuth(): Promise<ReadAuth | null> {
  let keystore: Awaited<ReturnType<typeof loadKeystore>>;
  try {
    keystore = await loadKeystore();
  } catch {
    return null;
  }

  try {
    const account = await createWalletAccountFromKeystore(keystore);
    const signature = await account.signMessage({
      message: buildReadAuthMessage(keystore.walletAddress),
    });
    return {
      walletAddress: keystore.walletAddress,
      headers: {
        [READ_AUTH_ADDRESS_HEADER]: keystore.walletAddress,
        [READ_AUTH_SIGNATURE_HEADER]: signature,
      },
    };
  } catch {
    return { walletAddress: keystore.walletAddress, headers: {} };
  }
}
