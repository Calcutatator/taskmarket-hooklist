// Implements: ADR-0003 (boot fails fast on indexer/award reconciliation)
// migrate -> catchUpIndexer -> reconcileTaskAwards run as one awaited sequence, with no
// error handling, before server.ts calls app.listen() -- any failure here is fatal to
// backend startup by design.
export type BackendPreparationDependencies = {
  catchUpIndexer: () => Promise<void>;
  migrate: () => Promise<void>;
  reconcileTaskAwards: () => Promise<void>;
};

/** Prepare durable database state in foreign-key dependency order. */
export async function prepareBackendState(
  dependencies: BackendPreparationDependencies
): Promise<void> {
  await dependencies.migrate();
  await dependencies.catchUpIndexer();
  await dependencies.reconcileTaskAwards();
}
