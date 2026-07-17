/**
 * Share one in-flight poll across overlapping scheduler ticks. The active
 * promise is cleared after settlement so the following tick can run normally.
 */
export function createSerializedPoll<Result>(
  pollOperation: () => Promise<Result>
): () => Promise<Result> {
  let activePoll: Promise<Result> | null = null;

  return () => {
    if (activePoll) return activePoll;

    activePoll = pollOperation().finally(() => {
      activePoll = null;
    });
    return activePoll;
  };
}
