import type { TaskResponse } from '@taskmarket/shared';

type GuidanceTask = Pick<TaskResponse, 'auctionType' | 'mode'>;

export function requesterWaitingCopy(task: GuidanceTask) {
  switch (task.mode) {
    case 'benchmark':
      return 'Workers can submit benchmark proofs until the deadline. When proofs arrive, review them here or from your Inbox.';
    case 'claim':
      return 'The first eligible worker can claim this task. After they deliver, review their submission here or from your Inbox.';
    case 'pitch':
      return 'Workers can pitch until the pitch deadline. When pitches arrive, compare them and select a worker here or from your Inbox.';
    case 'auction':
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        return 'The first worker to accept the current clock price wins. After they deliver, review their submission here or from your Inbox.';
      }
      return 'Workers can bid until the bid deadline. The lowest eligible bid can be finalized after the window closes; review delivered work from your Inbox.';
    case 'bounty':
    default:
      return 'Workers can submit work until the deadline. When submissions arrive, review them here or from your Inbox.';
  }
}
