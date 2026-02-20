import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const txHash = '0xec63bf57360e4feac46bb6ee6f495104b459833a4ef3548caa508ded58a96694' as `0x${string}`;

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    console.log('Status:', receipt.status);
    console.log('Block:', receipt.blockNumber);
    console.log('Gas used:', receipt.gasUsed);
    console.log('Logs:', receipt.logs.length);
  } catch (e) {
    console.log('Receipt not found (tx may still be pending)');
    try {
      const tx = await client.getTransaction({ hash: txHash });
      console.log('Tx pending in block:', tx.blockNumber, 'nonce:', tx.nonce);
    } catch (e2) {
      console.log('Tx not found on chain at all');
    }
  }
}
main().catch(console.error);
