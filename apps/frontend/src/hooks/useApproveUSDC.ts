import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { USDC_ADDRESS, USDC_ABI, TASK_MARKET_ADDRESS } from '@/lib/contracts';

export function useApproveUSDC() {
  const { address } = useAccount();

  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, TASK_MARKET_ADDRESS] : undefined,
  });

  const { writeContract, isPending, isSuccess, data: hash } = useWriteContract();

  const approve = (amount: bigint) => {
    if (allowance && allowance >= amount) {
      return Promise.resolve();
    }

    return writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [TASK_MARKET_ADDRESS, amount],
    });
  };

  const isApproved = (amount: bigint) => {
    return allowance ? allowance >= amount : false;
  };

  return {
    approve,
    isApproved,
    isPending,
    isSuccess,
    hash,
    allowance,
  };
}
