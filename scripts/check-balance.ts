import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';

async function main() {
  const pk = process.env.DEV_PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(pk);
  console.log('Wallet address:', account.address);

  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;

  const usdc = await client.readContract({
    address: usdcAddress,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('USDC balance:', formatUnits(usdc, 6), 'USDC');

  const eth = await client.getBalance({ address: account.address });
  console.log('ETH balance: ', formatUnits(eth, 18), 'ETH');
}

main().catch(console.error);
