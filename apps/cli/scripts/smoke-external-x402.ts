import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createServer as createHttpsServer } from 'https';
import { createServer as createNetServer } from 'net';
import os from 'os';
import path from 'path';

import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme as ExactEvmFacilitator } from '@x402/evm/exact/facilitator';
import { UptoEvmScheme as UptoEvmFacilitator } from '@x402/evm/upto/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
  publicActions,
  verifyTypedData,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { executeExternalX402Request } from '../src/lib/external-x402-client.js';

const BASE_RPC_URL = process.env['X402_SMOKE_FORK_URL'] ?? 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MASTER_MINTER = '0x2230393EDAD0299b7E7B59F20AA856cD1bEd52e1';
const NETWORK = 'eip155:8453' as const;

const usdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function configureMinter(address,uint256) returns (bool)',
  'function mint(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'Unable to allocate a local port');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForRpc(rpcUrl: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Anvil exited with ${process.exitCode}`);
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch {
      // The fork is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the Base fork');
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `RPC ${method} failed`);
  return body.result as T;
}

async function main() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmarket-x402-smoke-'));
  const rpcPort = await freePort();
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const anvil = spawn(
    'anvil',
    ['--fork-url', BASE_RPC_URL, '--chain-id', '8453', '--port', String(rpcPort), '--silent'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let serviceServer: ReturnType<typeof createHttpsServer> | undefined;
  try {
    await waitForRpc(rpcUrl, anvil);
    const payer = privateKeyToAccount(generatePrivateKey());
    const facilitator = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey());
    await rpc(rpcUrl, 'anvil_setBalance', [payer.address, '0x56BC75E2D63100000']);
    await rpc(rpcUrl, 'anvil_setBalance', [facilitator.address, '0x56BC75E2D63100000']);
    const chain = defineChain({
      id: 8453,
      name: 'Base fork',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const payerClient = createWalletClient({ account: payer, chain, transport: http(rpcUrl) }).extend(
      publicActions
    );
    const facilitatorClient = createWalletClient({
      account: facilitator,
      chain,
      transport: http(rpcUrl),
    }).extend(publicActions);

    await rpc(rpcUrl, 'anvil_impersonateAccount', [MASTER_MINTER]);
    await rpc(rpcUrl, 'anvil_setBalance', [MASTER_MINTER, '0x56BC75E2D63100000']);
    const configureData = encodeFunctionData({
      abi: usdcAbi,
      functionName: 'configureMinter',
      args: [payer.address, 10_000_000n],
    });
    const configureHash = await rpc<`0x${string}`>(rpcUrl, 'eth_sendTransaction', [
      { from: MASTER_MINTER, to: USDC, data: configureData },
    ]);
    await publicClient.waitForTransactionReceipt({ hash: configureHash });
    await payerClient.writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'mint',
      args: [payer.address, 1_000_000n],
    });
    const facilitatorSigner = toFacilitatorEvmSigner({
      address: facilitator.address,
      readContract: (args) => facilitatorClient.readContract(args as never),
      verifyTypedData: (args) => verifyTypedData(args as never),
      writeContract: (args) =>
        facilitatorClient.writeContract({ ...args, account: facilitator, chain } as never),
      sendTransaction: (args) =>
        facilitatorClient.sendTransaction({ ...args, account: facilitator, chain }),
      waitForTransactionReceipt: async (args) => {
        const receipt = await facilitatorClient.waitForTransactionReceipt(args);
        return { status: receipt.status, logs: receipt.logs };
      },
      getCode: (args) => publicClient.getCode(args),
    });
    const exactFacilitator = new ExactEvmFacilitator(facilitatorSigner);
    const uptoFacilitator = new UptoEvmFacilitator(facilitatorSigner);

    const certificatePath = path.join(temporaryDirectory, 'certificate.pem');
    const keyPath = path.join(temporaryDirectory, 'key.pem');
    const openssl = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certificatePath,
      ],
      { stdio: 'ignore' }
    );
    assert(openssl.status === 0, 'Unable to generate local HTTPS certificate');

    let serviceOrigin = '';
    let lastUptoPayload: PaymentPayload | undefined;
    let lastUptoRequirement: PaymentRequirements | undefined;
    serviceServer = createHttpsServer(
      {
        key: await fs.readFile(keyPath),
        cert: await fs.readFile(certificatePath),
      },
      async (request, response) => {
        try {
          const pathname = new URL(request.url ?? '/', serviceOrigin).pathname;
          const scheme = pathname === '/exact' ? 'exact' : 'upto';
          const maximum = scheme === 'exact' ? '100000' : '200000';
          const requirements: PaymentRequirements = {
            scheme,
            network: NETWORK,
            amount: maximum,
            asset: USDC,
            payTo: recipient.address,
            maxTimeoutSeconds: 300,
            extra:
              scheme === 'exact'
                ? { name: 'USD Coin', version: '2' }
                : { facilitatorAddress: facilitator.address },
          };
          const paymentRequired = {
            x402Version: 2,
            error: 'Payment required',
            resource: {
              url: `${serviceOrigin}${pathname}`,
              description: 'External x402 smoke resource',
              mimeType: 'application/json',
            },
            accepts: [requirements],
          };
          const signatureHeader = request.headers['payment-signature'];
          if (typeof signatureHeader !== 'string') {
            response.writeHead(402, {
              'content-type': 'application/json',
              'payment-required': base64Json(paymentRequired),
            });
            response.end(JSON.stringify(paymentRequired));
            return;
          }
          const payload = JSON.parse(
            Buffer.from(signatureHeader, 'base64').toString('utf8')
          ) as PaymentPayload;
          const mechanism = scheme === 'exact' ? exactFacilitator : uptoFacilitator;
          const verified = await mechanism.verify(payload, requirements);
          assert(verified.isValid, `Payment verification failed: ${verified.invalidReason}`);
          const settleAmount = pathname === '/upto-zero' ? '0' : scheme === 'upto' ? '73000' : maximum;
          const settlementRequirements = { ...requirements, amount: settleAmount };
          const settlement = await mechanism.settle(payload, settlementRequirements);
          assert(settlement.success, `Payment settlement failed: ${settlement.errorReason}`);
          if (scheme === 'upto' && settleAmount !== '0') {
            lastUptoPayload = payload;
            lastUptoRequirement = requirements;
          }
          response.writeHead(200, {
            'content-type': 'application/json',
            'payment-response': base64Json(settlement),
          });
          response.end(JSON.stringify({ scheme, maximum, settled: settleAmount }));
        } catch (error) {
          process.stderr.write(
            `Smoke resource error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
          );
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          );
        }
      }
    );
    const httpsPort = await freePort();
    await new Promise<void>((resolve) => serviceServer!.listen(httpsPort, '127.0.0.1', resolve));
    serviceOrigin = `https://127.0.0.1:${httpsPort}`;
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    process.env['TASKMARKET_X402_POLICY_PATH'] = path.join(temporaryDirectory, 'policy.json');
    process.env['TASKMARKET_X402_JOURNAL_PATH'] = path.join(temporaryDirectory, 'journal.jsonl');
    process.env['X402_SMOKE_RPC_URL'] = rpcUrl;
    await fs.writeFile(
      process.env['TASKMARKET_X402_POLICY_PATH'],
      JSON.stringify({
        version: 1,
        networks: { [NETWORK]: { rpcUrlEnv: 'X402_SMOKE_RPC_URL' } },
        rules: [
          {
            id: 'fork-smoke',
            origin: serviceOrigin,
            methods: ['GET'],
            unattended: true,
            allowPrivateNetwork: true,
            payments: [
              {
                scheme: 'exact',
                network: NETWORK,
                asset: USDC,
                payTo: recipient.address,
                maxPerPayment: '100000',
                spendWindow: { seconds: 3600, max: '100000' }
              },
              {
                scheme: 'upto',
                network: NETWORK,
                asset: USDC,
                payTo: recipient.address,
                maxPerPayment: '200000',
                spendWindow: { seconds: 3600, max: '400000' },
                permit2: {
                  allowSponsoredApproval: true,
                  allowDirectApproval: true,
                  allowUnattendedDirectApproval: true,
                  maxApprovalGasWei: '10000000000000000'
                }
              }
            ]
          }
        ]
      }),
      { mode: 0o600 }
    );

    const startingBalance = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [recipient.address],
    })) as bigint;
    const exact = await executeExternalX402Request({
      rawUrl: `${serviceOrigin}/exact`,
      nonInteractive: true,
      policyRuleId: 'fork-smoke',
      account: payer,
    });
    assert(exact.payment?.settledAmount === '100000', 'Exact settlement amount was not recorded');
    const afterExact = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [recipient.address],
    })) as bigint;
    assert(afterExact - startingBalance === 100_000n, 'Exact token movement was not 100000');

    const upto = await executeExternalX402Request({
      rawUrl: `${serviceOrigin}/upto`,
      nonInteractive: true,
      policyRuleId: 'fork-smoke',
      account: payer,
    });
    assert(upto.payment?.authorizedAmount === '200000', 'Upto maximum was not recorded');
    assert(upto.payment?.settledAmount === '73000', 'Upto actual amount was not recorded');
    assert(upto.payment?.approvalMode === 'direct', 'Upto did not execute direct Permit2 approval');
    assert(
      upto.payment?.approvalTargetAllowance === '400000',
      'Permit2 approval was not bounded to the rolling window'
    );
    const afterUpto = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [recipient.address],
    })) as bigint;
    assert(afterUpto - afterExact === 73_000n, 'Upto token movement was not 73000');

    const zero = await executeExternalX402Request({
      rawUrl: `${serviceOrigin}/upto-zero`,
      nonInteractive: true,
      policyRuleId: 'fork-smoke',
      account: payer,
    });
    assert(zero.payment?.settledAmount === '0', 'Zero upto settlement was not recorded');
    const afterZero = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [recipient.address],
    })) as bigint;
    assert(afterZero === afterUpto, 'Zero upto settlement moved tokens');

    assert(lastUptoPayload && lastUptoRequirement, 'Upto payload was not captured');
    const replay = await uptoFacilitator.verify(lastUptoPayload, lastUptoRequirement);
    assert(!replay.isValid, 'Consumed upto nonce verified a second time');

    process.stdout.write(
      `${JSON.stringify({ ok: true, exact: exact.payment, upto: upto.payment, zero: zero.payment })}\n`
    );
  } finally {
    if (serviceServer?.listening) {
      serviceServer.closeAllConnections();
      await new Promise<void>((resolve) => serviceServer!.close(() => resolve()));
    }
    if (anvil.exitCode === null) {
      anvil.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (anvil.exitCode === null) anvil.kill('SIGKILL');
          resolve();
        }, 2_000);
        anvil.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
