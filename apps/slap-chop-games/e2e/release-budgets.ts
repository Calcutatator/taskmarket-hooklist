// Release budgets exercise the production Next build against the deterministic local fixture.
// They intentionally include a CI scheduling allowance while staying tight enough to catch a
// synchronous catalog render, client-search, or player-startup regression before release.
export const RELEASE_BUDGETS_MS = {
  catalogFailure: 2_500,
  catalogFirstRender: 2_500,
  catalogSearchAcross48: 300,
  playerFailure: 3_000,
  playerLoading: 1_500,
  playerStartup: 3_000,
} as const;

export const RELEASE_FIXTURE_DELAYS_MS = {
  artifact: 350,
  catalog: 250,
  failingCover: 500,
} as const;
