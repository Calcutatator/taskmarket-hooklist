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
