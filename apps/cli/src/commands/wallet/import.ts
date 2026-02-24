import { Command } from 'commander';
import { createInterface } from 'readline';
import { privateKeyToAccount } from 'viem/accounts';
import {
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  getKeystorePath,
  loadKeystore,
} from '../../lib/keystore.js';
import { API_URL } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';
import { pollAgentId } from '../../lib/agent.js';

function normalizePrivateKey(raw: string): `0x${string}` {
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }
  return `0x${hex}` as `0x${string}`;
}

function promptHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(prompt);

    // Suppress echo
    const muted = { muted: false };
    const _write = (rl as unknown as { output: { write: (s: string) => void } }).output.write.bind(
      (rl as unknown as { output: { write: (s: string) => void } }).output
    );
    (rl as unknown as { output: { write: (s: string) => void } }).output.write = (s: string) => {
      if (muted.muted) return;
      _write(s);
    };
    muted.muted = true;

    rl.question('', (answer) => {
      muted.muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

export const walletImportCommand = new Command('import')
  .description('Import an existing private key as the agent wallet')
  .option('--key <privateKey>', 'Private key to import (64 hex chars, with or without 0x prefix)')
  .option('--human', 'Human-readable output')
  .action(async (opts: { key?: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);

    if (await keystoreExists()) {
      const keystore = await loadKeystore();
      if (human) {
        console.log('Wallet already exists:', keystore.walletAddress);
        if (keystore.agentId) console.log('Agent ID:', keystore.agentId);
      } else {
        printResult({ address: keystore.walletAddress, agentId: keystore.agentId }, human);
      }
      return;
    }

    // Determine key source: --key flag, env var, or interactive prompt
    let rawKey: string;
    let keySource: 'flag' | 'env' | 'prompt';

    if (opts.key) {
      rawKey = opts.key;
      keySource = 'flag';
    } else if (process.env['TASKMARKET_IMPORT_KEY']) {
      rawKey = process.env['TASKMARKET_IMPORT_KEY'];
      keySource = 'env';
    } else {
      rawKey = await promptHiddenInput('Enter private key (input hidden): ');
      keySource = 'prompt';
    }

    const privateKey = normalizePrivateKey(rawKey);
    const account = privateKeyToAccount(privateKey);
    const address = account.address;

    // Register device with backend
    const res = await fetch(`${API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Device registration failed (${res.status}): ${text}`);
    }

    const {
      deviceId,
      apiToken,
      deviceEncryptionKey,
      agentId: initialAgentId,
    } = (await res.json()) as {
      deviceId: string;
      apiToken: string;
      deviceEncryptionKey: string;
      agentId: string | null;
    };

    const encryptedKey = encryptPrivateKey(deviceEncryptionKey, privateKey);

    // agentId may be null if on-chain registration is still pending — poll for it
    let agentId: string | null = initialAgentId;
    await saveKeystore({ encryptedKey, walletAddress: address, deviceId, apiToken, agentId });

    if (!agentId) {
      agentId = await pollAgentId(address);
      if (agentId) {
        const keystore = await loadKeystore();
        await saveKeystore({ ...keystore, agentId });
      }
    }

    if (human) {
      console.log('Wallet imported:', address);
      console.log('Agent ID:', agentId ?? '(pending — run `taskmarket init` again shortly)');
      console.log('Keystore saved to:', getKeystorePath());

      if (keySource === 'flag') {
        console.log('');
        console.log(
          'Warning: private key was passed via --key flag. It may be visible in shell history'
        );
        console.log('and in process listings (ps aux) while the command ran.');
        console.log('To remove it from shell history:');
        console.log('');
        console.log('  # zsh');
        console.log("  fc -W; sed -i '' '$d' ~/.zsh_history");
        console.log('');
        console.log('  # bash');
        console.log("  history -d $(history 1 | awk '{print $1}') && history -w");
      } else if (keySource === 'env') {
        console.log('');
        console.log('Note: key was read from TASKMARKET_IMPORT_KEY env var.');
        console.log('This is secure only when injected at runtime by your orchestration platform');
        console.log('(Docker -e, Kubernetes Secret, systemd EnvironmentFile).');
        console.log('If set in a dotfile (.env, .zshrc), the agent can read it — avoid this.');
      }
    } else {
      if (keySource === 'flag') {
        console.error(
          JSON.stringify({
            warning:
              'Private key was passed via --key flag and may be visible in shell history and ps aux.',
          })
        );
      }
      printResult({ address, agentId }, human);
    }
  });
