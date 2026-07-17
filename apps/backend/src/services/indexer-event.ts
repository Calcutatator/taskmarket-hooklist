type IndexedEventDependencies<Event> = {
  isAlreadyProcessed: (event: Event) => Promise<boolean>;
  markProcessed: (event: Event) => Promise<void>;
  processEvent: (event: Event) => Promise<boolean | void>;
};

/**
 * Process and mark one event in order. Handler failures escape so the caller
 * can preserve its range checkpoint and retry the event on the next poll.
 */
export async function processIndexedEvent<Event>(
  event: Event,
  dependencies: IndexedEventDependencies<Event>
): Promise<boolean> {
  if (await dependencies.isAlreadyProcessed(event)) return false;

  const handled = await dependencies.processEvent(event);
  if (handled === false) return false;

  await dependencies.markProcessed(event);
  return true;
}
