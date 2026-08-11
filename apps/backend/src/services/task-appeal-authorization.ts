import { zeroAddress } from 'viem';
import { contractGetContestAppealState } from './contract';

type AppealTask = {
  id: string;
  mode: string;
  claimedBy: string | null;
  contractAddress?: string | null;
};

export type AppealAuthorization = {
  authorized: boolean;
  authority: 'worker' | 'submitter' | 'unverified';
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function resolveAppealAuthorization(
  task: AppealTask,
  payer: string
): Promise<AppealAuthorization> {
  if (task.claimedBy) {
    return { authorized: sameAddress(task.claimedBy, payer), authority: 'worker' };
  }

  if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
    return { authorized: false, authority: 'worker' };
  }

  try {
    const chainState = await contractGetContestAppealState(
      task.id as `0x${string}`,
      payer as `0x${string}`,
      task.contractAddress
    );
    if (!sameAddress(chainState.claimedWorker, zeroAddress)) {
      return {
        authorized: sameAddress(chainState.claimedWorker, payer),
        authority: 'worker',
      };
    }
    return { authorized: chainState.hasSubmission, authority: 'submitter' };
  } catch {
    return { authorized: false, authority: 'unverified' };
  }
}
