import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters, toHex, stringToHex, toBytes, hexToString } from 'viem';
import { baseSepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;

  // Get the actual DOMAIN_SEPARATOR from the contract
  const domainSeparator = await client.readContract({
    address: usdcAddress,
    abi: [{ name: 'DOMAIN_SEPARATOR', type: 'function', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' }],
    functionName: 'DOMAIN_SEPARATOR',
  });
  console.log('Actual DOMAIN_SEPARATOR:', domainSeparator);

  // Get name from the contract
  const name = await client.readContract({
    address: usdcAddress,
    abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' }],
    functionName: 'name',
  });
  console.log('Contract name:', name);

  // Get version from the contract
  const version = await client.readContract({
    address: usdcAddress,
    abi: [{ name: 'version', type: 'function', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' }],
    functionName: 'version',
  });
  console.log('Contract version:', version);

  // Compute what our domain separator would be with name='USDC'
  const DOMAIN_TYPE_HASH = keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));

  const computeDS = (domainName: string) => keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
    [
      DOMAIN_TYPE_HASH,
      keccak256(toBytes(domainName)),
      keccak256(toBytes(version as string)),
      84532n,
      usdcAddress,
    ]
  ));

  console.log('\nExpected DS with name="USDC":', computeDS('USDC'));
  console.log('Expected DS with contract name:', computeDS(name as string));
  console.log('Match with "USDC":', computeDS('USDC') === domainSeparator);
  console.log('Match with contract name:', computeDS(name as string) === domainSeparator);
}
main().catch(console.error);
