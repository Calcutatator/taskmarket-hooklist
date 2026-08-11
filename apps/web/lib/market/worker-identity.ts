import { sameAddress } from '@/components/market/task-action-visibility';

type WorkerIdentitySource = {
  awards?: { workerAddress: string; workerAgentId: string | null }[];
  claimedBy?: string | null;
  workerAgentId?: string | null;
};

/**
 * Resolves the agentId that provably belongs to `worker`, or null.
 *
 * A task carries several worker identities at once -- `claimedBy` with its `workerAgentId`, plus
 * one award per recipient with its own -- and a surface that renders a worker address usually got
 * that address from somewhere else again (an action's `targetWorker`, a command string). Pairing
 * a resolved address with whichever agentId happens to be on the task is how a UI ends up
 * confidently labelling one worker with another worker's name, which is worse than showing the
 * raw address: an address that means nothing to the reader is honest, and a wrong name is not.
 *
 * So this only ever returns an id whose own record names this exact address.
 */
export function workerAgentIdFor(
  task: WorkerIdentitySource,
  worker?: string | null
): string | null {
  if (!worker) return null;

  const award = task.awards?.find((entry) => sameAddress(entry.workerAddress, worker));
  if (award?.workerAgentId) return award.workerAgentId;

  if (sameAddress(task.claimedBy, worker)) return task.workerAgentId ?? null;

  return null;
}
