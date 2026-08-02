# UI CI

The production web app lives in `apps/web`. Its UI workflow has three layers: Storybook for
isolated component states, Playwright for production application routes, and the per-PR
Railway environment for deployed review. Run every layer through the Makefile so local and
CI behavior stay aligned.

## Full gate

Run the complete local UI gate with:

```sh
make ui-ci
```

Install browser binaries once first:

```sh
make ui-ci-install-browsers
```

The full gate checks:

- Storybook component-module coverage and exclusion hygiene;
- the static Storybook production build;
- browser rendering for every story and Storybook `play` interaction;
- blocking accessibility checks for every non-legacy story file;
- linting, formatting, and TypeScript for `@taskmarket/web`;
- Vitest component and utility tests for `@taskmarket/web`;
- the production Next.js build;
- Playwright route and interaction regression tests against the production server.

CI runs the Storybook and application shards separately for useful failure reporting. The
aggregate `ui` job depends on all of them and is the GitHub equivalent of `make ui-ci`.

## Storybook inner loop

Start Storybook with:

```sh
make storybook
```

For every independently renderable UI change:

1. Find the component and current story before editing.
2. Add or update every materially changed state.
3. Inspect relevant viewport and theme variants in the browser.
4. Exercise changed pointer and keyboard interactions.
5. Add `play` assertions and blocking accessibility checks where applicable.
6. Run `make storybook-ci` before the full UI gate.

Coverage markers declare which component modules a story exercises. They prevent catalogue
omissions but do not prove state completeness; reviewers must still inspect whether the
story represents the changed behavior. Components that cannot render independently need a
specific reason in `apps/web/.storybook/component-exclusions.json`.
Existing story files with unresolved axe findings must be named in
`apps/web/.storybook/a11y-legacy.json`; the coverage check rejects unlisted and stale
exceptions, and every new story file must use blocking accessibility checks.

## Browser regression coverage

Playwright tests live in `apps/web/e2e`. They start a mock API server so the UI can be tested
without a deployed backend or seeded database. The public route sweep currently covers:

- `/` and `/try`;
- `/tasks`, `/agents`, `/humans`, `/leaderboard`, and `/protocol`;
- `/dashboard`;
- `/dashboard/tasks`, `/dashboard/drops`, `/dashboard/agents`, and `/dashboard/humans`;
- `/dashboard/leaderboard`, `/dashboard/protocol`, and `/dashboard/for-agents`.

Routes are checked in desktop and mobile projects for:

- the expected page heading;
- no Next.js application error text;
- no browser console or unhandled page errors;
- no horizontal document overflow.

Dedicated tests cover meaningful interactions and high-risk responsive states. Add a route to
`publicRoutes` in `apps/web/e2e/ui-regression.spec.ts` when adding a top-level public screen.
For a meaningful flow, add a dedicated Playwright test that asserts the user-visible result
instead of only checking that the page renders.

## PR review surface

Every PR preview deploys both the production frontend and Storybook inside the same Railway
project and per-PR environment. The preview workflow comments on the PR with both URLs.

The author or agent must record:

- the Storybook story names reviewed;
- the viewports and themes relevant to the change;
- the integrated frontend route reviewed;
- any expected visual or accessibility exceptions.

The reviewer confirms the isolated state in Storybook, then verifies the integrated behavior
in the frontend preview. Storybook is the fast component loop; the frontend preview remains
the production-like acceptance surface.

## CI artifacts

GitHub Actions uploads the static Storybook build plus Playwright reports, traces,
screenshots, and videos. Use the Railway Storybook URL for normal review and the artifacts to
debug failures before re-running CI.
