# 0102 — URL-backed components are tested against a working URL, not a no-op router

> **Decision (Y-statement):** In the context of UI state having moved into the URL, facing test
> harnesses whose router stubs are no-ops so a component cannot observe its own navigation, we
> decided that the unit project's `next/navigation` mock is a working in-memory URL with a
> back-stack, scoped away from the Storybook project, to achieve tests that fail for real defects
> rather than for the harness, accepting a shared test fixture that is now behaviour rather than a
> stub.

- **Status:** Accepted
- **Date:** 2026-08-18
- **Accepted:** 2026-08-18
- **Embodiment:** Verified
- **Last audited:** 2026-08-18
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

`apps/web/test/setup.ts` stubbed `useRouter` with no-op `push` and `replace`, because until
recently the only thing tests needed from the router was that calling it did not throw outside an
app-router context.

ADR-0096 makes the URL the single store for shareable UI state. A component now writes the address
and reads its own state back from it, so against a no-op router it writes into nothing and reads
back the address it started with. The round trip is broken in exactly one place — the test
environment — and every URL-backed component looks broken while being correct in a browser. That is
worse than a missing test: it is a harness that reports failure for working code, which trains
people to weaken assertions.

Three harnesses had this shape: the shared `test/setup.ts`, and file-level mocks in
`components/market/tasks.test.tsx` and `components/market/live-activity.test.tsx`.

There is a real hazard in fixing it in the obvious place. The Storybook browser project loads
`test/setup.ts` even though `vitest.config.ts` declares `setupFiles: []` for it, and
`@storybook/nextjs-vite` supplies its own Next navigation mocks. Replacing `usePathname` and
`useSearchParams` in the shared setup clobbered those and broke two stories with nothing to do with
URL state — an accessibility check and a status banner — in a way that named neither the cause nor
the file.

The honest framing of the risk: this is test infrastructure being made more permissive so that new
code passes. That deserves scrutiny. The mitigating fact is the direction of the change — the new
stub does what a browser does, where the old one did nothing — but it is still a shared fixture that
now has behaviour, and behaviour can be wrong.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| A working in-memory URL in a unit-only setup file | Tests exercise the real round trip, so a broken one fails; `back()` becomes real, which is what ADR-0096's close-behaviour needs; one fixture rather than a stub per file | A shared fixture with behaviour, which can itself be wrong; a second setup file to know about |
| Extend the existing shared `test/setup.ts` (rejected) | One file, no config change | Clobbers `@storybook/nextjs-vite`'s navigation mocks in the Storybook project, which loads that file despite `setupFiles: []`; breaks unrelated stories with an error naming neither cause nor file |
| Per-file router stubs in each test that needs one (rejected) | No shared fixture; each test states its own needs | The same stub copied into every file that touches URL state, drifting independently — the duplication `test/setup.ts` was created to remove |
| Assert on `router.push` spy calls instead of observed state (rejected) | No fixture behaviour at all | Tests the call rather than the result, so a component that writes the right URL and reads the wrong thing back still passes — which is the exact defect class ADR-0096 exists to remove |
| Drive everything through Playwright instead (rejected) | Real browser, real history, no fixture | Minutes per case instead of milliseconds; unsuitable for the per-component states the frontend guide requires |

## Decision

The unit project's `next/navigation` mock is a working in-memory URL: `push` and `replace` update a
store that `useSearchParams` and `usePathname` read, and a history stack makes `back()` real.

It lives in `apps/web/test/setup-url.ts`, registered only on the unit project in
`vitest.config.ts`, because the Storybook browser project loads the shared setup and must keep
`@storybook/nextjs-vite`'s own navigation mocks.

A test that needs specific navigation behaviour still overrides this with its own file-level
`vi.mock`; where it does, that mock must also be a working URL rather than a set of spies.

## Consequences

**Positive:**

- A URL-backed component's round trip is exercised, so a component that writes the address and
  reads back the wrong thing fails where it should.
- `back()` is real, which is the only way to test ADR-0096's rule that closing an overlay pops only
  an entry this session pushed.
- One fixture instead of a stub per file, and the failure mode it removes — a correct component
  looking broken — no longer trains people to weaken assertions.

**Negative / trade-offs:**

- Shared test infrastructure now has behaviour, and behaviour can be wrong in ways a stub cannot.
  A defect here is invisible in the same way the no-op router was.
- Two setup files, and a non-obvious reason for the split that lives in a comment and in this ADR.
- The Storybook project's navigation mock stays fixed per story, so a single story cannot both act
  and observe the resulting address. Covering a round trip there takes a pair of stories — one for
  the trigger, one starting from the deep link.

**Neutral / follow-up:**

- **The fixtures landed in this branch ahead of this decision**, because the change looked like
  test plumbing at the time. It is not — a shared fixture that decides whether URL-backed
  components can be tested at all is a decision — which is why this ADR exists. Accepted after the
  fact rather than before, and recorded that way rather than backdated.

- `vitest.config.ts`'s Storybook project declares `setupFiles: []` and yet loads the shared setup.
  That is the surprising fact underneath this split; if it is ever fixed upstream, the scoping can
  be revisited.

## References

- Where shareable state lives: ADR-0096
- Param namespace: ADR-0097
- Fixtures: `apps/web/test/setup-url.ts`, `apps/web/vitest.config.ts`
- Frontend requirements this serves: `docs/FRONTEND_GUIDE.md`
