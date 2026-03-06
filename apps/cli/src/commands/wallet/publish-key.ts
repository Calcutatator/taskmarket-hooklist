import { Command } from 'commander';
import { loadKeystore, decryptPrivateKey } from '../../lib/keystore.js';
import { fetchDeviceKey } from '../../lib/signer.js';
import { deriveCompressedPublicKey } from '../../lib/encryption.js';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const publishKeyCommand = new Command('publish-key')
  .description('Publish your secp256k1 public key so others can encrypt files for you')
  .action(async () => {
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
    }

    const dek = await fetchDeviceKey(keystore.deviceId, keystore.apiToken);
    const privateKey = decryptPrivateKey(dek, keystore.encryptedKey);
    const publicKey = deriveCompressedPublicKey(privateKey);

    const result = (await apiPost('/trpc/agents.setPublicKey', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      publicKey,
    })) as { result: { data: { publicKey: string } } };

    printResult({ publicKey: result.result.data.publicKey });
  });
