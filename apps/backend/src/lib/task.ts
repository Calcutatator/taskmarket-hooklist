export function computeSubmissionWindowOpen(
  task: {
    status: string;
    mode: string;
    expiryTime: Date;
    pitchDeadline?: Date | null;
    bidDeadline?: Date | null;
  },
  now: Date
): boolean {
  if (task.status !== 'open') return false;
  switch (task.mode) {
    case 'bounty':
    case 'benchmark':
    case 'claim':
      return task.expiryTime > now;
    case 'pitch':
      return (task.pitchDeadline ?? task.expiryTime) > now;
    case 'auction':
      return (task.bidDeadline ?? task.expiryTime) > now;
    default:
      return false;
  }
}
