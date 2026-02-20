import { createPublicClient, http, decodeFunctionData, decodeErrorResult, hexToString, slice } from 'viem';
import { baseSepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const txHash = '0xec63bf57360e4feac46bb6ee6f495104b459833a4ef3548caa508ded58a96694' as `0x${string}`;

  const tx = await client.getTransaction({ hash: txHash });
  console.log('To:', tx.to);
  console.log('From:', tx.from);

  const TWA_ABI = [{
    name: 'transferWithAuthorization',
    type: 'function',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  }] as const;

  try {
    const decoded = decodeFunctionData({ abi: TWA_ABI, data: tx.input });
    console.log('\nDecoded call:', decoded.functionName);
    const [from, to, value, validAfter, validBefore, nonce, v, r, s] = decoded.args;
    console.log('  from:', from);
    console.log('  to:', to);
    console.log('  value:', value, '=', Number(value) / 1e6, 'USDC');
    console.log('  validAfter:', validAfter);
    console.log('  validBefore:', validBefore);
    console.log('  nonce:', nonce);
    console.log('  v:', v);
    console.log('  r:', r);
    console.log('  s:', s);
  } catch (e) {
    console.log('Could not decode as ECDSA overload, trying bytes overload...');
    console.log('Raw input prefix:', tx.input.slice(0, 20));
  }

  // Try to get revert reason via eth_call simulation
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  console.log('\nReceipt status:', receipt.status);
  console.log('Block:', receipt.blockNumber);

  // Simulate the same tx at that block to get revert data
  try {
    await client.call({
      account: tx.from,
      to: tx.to!,
      data: tx.input,
      blockNumber: receipt.blockNumber,
    });
    console.log('Simulation succeeded (unexpected)');
  } catch (simErr: any) {
    console.log('\nRevert reason:', simErr.message?.slice(0, 500));
    if (simErr.cause?.data) {
      const raw = simErr.cause.data;
      console.log('Raw revert data:', raw);
      // Try to decode as Error(string)
      try {
        const str = hexToString(slice(raw, 4) as `0x${string}`);
        console.log('Decoded error string:', str);
      } catch {}
    }
  }
}
main().catch(console.error);
