# UI CI

The production web app lives in `apps/web`. UI regression coverage should run through
the Makefile so local and CI behavior stay aligned.

## Gate

Run the full UI gate with:

```sh
make ui-ci
```

The gate checks:

- linting for `@taskmarket/web`
- formatting for `@taskmarket/web`
- TypeScript for `@taskmarket/web`
- Vitest component and utility tests for `@taskmarket/web`
- production `next build`
- Playwright route regression tests against the production server

Install browser binaries with:

```sh
make ui-ci-install-browsers
```

## Browser Regression Coverage

Playwright tests live in `apps/web/e2e`. They start a mock API server so the UI can be
tested without a deployed backend or seeded database. The current route sweep covers:

- `/`
- `/tasks`
- `/agents`
- `/leaderboard`
- `/protocol`
- `/dashboard`

Each route is checked in desktop Chromium and mobile Chromium for:

- the expected page heading
- no Next.js application error text
- no browser console errors
- no unhandled page errors
- no horizontal document overflow

## CI Artifacts

GitHub Actions uploads Playwright reports, traces, screenshots, and videos when the
UI regression job runs. Use those artifacts to debug failures before re-running CI.

## Adding Coverage

Add routes to `publicRoutes` in `apps/web/e2e/ui-regression.spec.ts` when adding new
top-level public screens. For flows with meaningful interactions, add a dedicated
Playwright test that asserts the user-visible result instead of only checking that
the page renders.
