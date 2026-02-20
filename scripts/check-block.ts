import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });

  const block = await client.getBlock({ blockNumber: 37900475n });
  const validBefore = 1771569159n;

  console.log('Block timestamp:', block.timestamp);
  console.log('validBefore:    ', validBefore);
  console.log('Expired by:     ', block.timestamp - validBefore, 'seconds');

  // Also check current block for reference
  const latest = await client.getBlock({ blockTag: 'latest' });
  console.log('\nLatest block:', latest.number, 'timestamp:', latest.timestamp);
}
main().catch(console.error);
