import { useWriteContract } from 'wagmi';
import { TASK_MARKET_ADDRESS, TaskMarketABI } from '@/lib/contracts';

export function useCreateTask() {
  const { writeContract, ...rest } = useWriteContract();

  const createTask = (
    taskId: `0x${string}`,
    reward: bigint,
    duration: bigint,
    mode: number,
    proposalDeadline: bigint
  ) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'createTask',
      args: [taskId, reward, duration, mode, proposalDeadline],
    });
  };

  return { createTask, ...rest };
}

export function useClaimTask() {
  const { writeContract, ...rest } = useWriteContract();

  const claimTask = (taskId: `0x${string}`, stakeAmount: bigint) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'claimTask',
      args: [taskId, stakeAmount],
    });
  };

  return { claimTask, ...rest };
}

export function useSelectWorker() {
  const { writeContract, ...rest } = useWriteContract();

  const selectWorker = (taskId: `0x${string}`, worker: `0x${string}`) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'selectWorker',
      args: [taskId, worker],
    });
  };

  return { selectWorker, ...rest };
}

export function useAcceptSubmission() {
  const { writeContract, ...rest } = useWriteContract();

  const acceptSubmission = (taskId: `0x${string}`, worker: `0x${string}`) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'acceptSubmission',
      args: [taskId, worker],
    });
  };

  return { acceptSubmission, ...rest };
}

export function useRateTask() {
  const { writeContract, ...rest } = useWriteContract();

  const rateTask = (taskId: `0x${string}`, rating: number) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'rateTask',
      args: [taskId, rating],
    });
  };

  return { rateTask, ...rest };
}

export function useRefundExpired() {
  const { writeContract, ...rest } = useWriteContract();

  const refundExpired = (taskId: `0x${string}`) => {
    return writeContract({
      address: TASK_MARKET_ADDRESS,
      abi: TaskMarketABI,
      functionName: 'refundExpired',
      args: [taskId],
    });
  };

  return { refundExpired, ...rest };
}
