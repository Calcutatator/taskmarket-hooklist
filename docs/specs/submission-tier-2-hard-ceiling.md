# RFC-0006 Tier 2 + shared rate-limiting module (`rate-limit.ts`): hard submission ceiling, and migrating the platform's existing rate limiters onto one shared implementation

> Version: 4.1 | Date: 2026-07-31 | Status: Ready
> **Implements ADRs:** ADR-0037, ADR-0038
> Depends on: ADR-0035, ADR-0036 (Tier 1, already shipped) | Feeds into: none yet

## Purpose

RFC-0006 Tier 1 (shipped) prices bounty/benchmark submissions past a free allowance, but pricing
alone doesn't bound total volume — a worker willing to pay can still submit an unbounded number of
times. ADR-0037 decided to build Tier 2: a hard, absolute ceiling of **100 submissions per
`(worker, task)` pair**, on top of Tier 1's pricing, independent of how much the worker is willing
to spend. Explicitly **not** platform-wide and **not** a running total across a worker's activity
— a fresh ceiling for every distinct task. This spec describes what's actually being built.

**Version 2.0 note**: version 1.0 of this spec proposed extending
`apps/backend/src/services/submission-allowance.ts` directly. Before implementation began,
ADR-0038 decided the fixed-ceiling check belongs in a new shared rate-limiting module instead (see
`apps/backend/src/lib/rate-limit.ts` below), alongside a second, separate function for the
codebase's existing time-windowed limiters. ADR-0037's own policy decision — 100, per
`(worker, task)` — is unchanged; only where the check lives moved. Do not use
`taskDropSubscribeRateLimits`/`taskAccessPasswordRateLimits` (`apps/backend/src/db/schema.ts`) as a
reference implementation for Tier 2 itself — those are a 1-hour sliding window, a different
mechanism that wouldn't bound the accumulated-over-time spam RFC-0006 was written for. Migrating
them onto the shared module's time-windowed function is now this same spec's own scope (see
Version 4.0 note) — they're the two real callers of that function, not an unrelated cleanup.

**Version 3.0 note**: this spec is the full handoff for the change — not just the backend check.
It now also covers: confirming the hard ceiling doesn't collide with the smoke suite's own raised
free-allowance override; a CLI-side improvement to the 429 error; a changeset entry (this does
reach a published package — the CLI — so the earlier "not applicable" call was wrong, see
Changeset below); and an addition to the agent-facing skill doc so an agent submitting artifacts
knows the free allowance and hard ceiling exist before it hits either one. Frontend (`apps/web`)
UX is still explicitly out of scope — see Non-goals.

**Version 3.1 correction**: version 3.0 misdiagnosed the CLI gap as "the CLI prints raw JSON
instead of a clean message" and proposed throwing a bare `Error(result.error)` string. That's
backwards — this CLI is agent-native and always returns JSON, on success and on failure alike
(`apps/cli/src/index.ts`'s top-level catch already wraps every error into the standardized `{ ok:
false, error }` envelope; ditching that for a bare string would have been a regression, not a
fix). The real, corrected gap: that JSON envelope carries no structured HTTP status today, only a
prose `error` string with the status number embedded inside it as text. See "CLI: structured
status on the existing JSON error envelope" below for the corrected design (an `ApiError` class
carrying `.status`, surfaced as an additive `status` field on the existing envelope).

**Version 4.0 note**: RFC-0006's own higher-level intent is to implement rate limiting as a real
platform capability, not a one-off for submissions. ADR-0038 originally deferred migrating the two
existing sliding-window limiters (`taskDropSubscribeRateLimits` for `task-drop-subscribe`,
`taskAccessPasswordRateLimits` for `task-access-password`) onto the new shared module's
time-windowed function as separate follow-up work, tracked in issue #372. That deferral was
corrected the same day, before either function was built — see ADR-0038's own "Correction" note.
**Both the time-windowed function and migrating both existing limiters onto it are now this spec's
scope, alongside the fixed-ceiling function Tier 2 itself needs.** Issue #372 is closed, its
content fully absorbed here — see "Migrating the existing rate limiters" below.

**Relationship to PR #369**: reviewing this spec against PR #369 (`docs/specs/
worker-grouped-submission-review.md`, the requester-side review-queue grouping fix for the same
spam incident) found a real, verified gap — benchmark tasks have an optional `submissions` channel
(alongside their primary `task proof` flow) that this spec's `HARD_SUBMISSION_CEILING` meters
identically to bounty, but that had **no frontend review surface at all**, grouped or otherwise,
because `LiveActivityPanel`'s `activeMode(task)` routes benchmark to `proofs` only. That gap
predates this spec and PR #369 both; it isn't introduced by either. The fix landed directly on PR
#369's branch as Milestone 5 (commit `59df9279`) — an additive secondary review surface reusing
PR #369's own grouping/action/history components against `modeData.submissions`, not touching the
primary proof feed. Not this spec's own scope; recorded here only as the finding's disposition.
Neither piece of work blocks the other.

## Design / Architecture

### Where the check lives

Create `apps/backend/src/lib/rate-limit.ts` (per ADR-0038), exporting a fixed-ceiling check as a
read-only count against an existing data source — no new table, no owned state:

```ts
export async function isOverFixedCeiling(
  database: Database,
  params: {
    count: () => Promise<number>;
    ceiling: number;
  }
): Promise<boolean> {
  const priorCount = await params.count();
  return priorCount >= params.ceiling;
}
```

The exact signature (whether `count` is a callback, as sketched above, or the module takes a more
direct `(database, table, keyColumns, keyValues, ceiling)` shape) is an implementation judgment
call — ADR-0038 only decided that this is a distinct function from the time-windowed check, not its
precise parameterization. Whichever shape is chosen, Tier 2's own call site is:

```ts
// apps/backend/src/services/submission-allowance.ts
export async function isOverHardSubmissionCeiling(
  database: Database,
  taskId: string,
  workerAddress: string
): Promise<boolean> {
  return isOverFixedCeiling(database, {
    count: () => countSuccessfulSubmissions(database, taskId, workerAddress),
    ceiling: HARD_SUBMISSION_CEILING,
  });
}
```

`countSuccessfulSubmissions` already exists and is reused as-is — no new query, no new table. The
only new state is the threshold constant itself. `isOverHardSubmissionCeiling` stays in
`submission-allowance.ts` (it's Tier 2's own domain-specific call, same home as Tier 1's checks) and
is a thin wrapper over the shared module's generic `isOverFixedCeiling`.

### Migrating the existing rate limiters onto `rate-limit.ts`'s time-windowed function

Checked directly: `apps/backend/src/services/task-drop-subscribe-rate-limit.ts` and
`apps/backend/src/lib/task-access-password.ts` back onto identically-shaped tables
(`taskDropSubscribeRateLimits`, `taskAccessPasswordRateLimits` — `apps/backend/src/db/schema.ts`):
both are `{ key: text primary key, windowStartedAt: timestamp, attempts: integer, updatedAt:
timestamp }`, both use the same 1-hour sliding-window `onConflictDoUpdate` CASE-WHEN
reset-or-increment SQL, differing only in table name, per-key limit (`LIMIT_PER_EMAIL = 3` /
`LIMIT_PER_CLIENT = 10` for the first, `LIMIT_PER_TASK = 10` for the second), and what error each
throws when over limit (`TRPCError({ code: 'TOO_MANY_REQUESTS' })` vs. a plain `Error` with
`.name = 'TASK_ACCESS_RATE_LIMITED'`). That identical shape is exactly why a shared, parameterized
function is viable, not just theoretically nice.

Add to `apps/backend/src/lib/rate-limit.ts`, alongside `isOverFixedCeiling`:

```ts
export async function consumeSlidingWindowAttempt(
  tx: Transaction, // whatever this repo's own transaction handle type is, matching db.transaction's tx param
  params: {
    table: SlidingWindowTable; // key/windowStartedAt/attempts/updatedAt columns — see below
    key: string;
    windowSeconds: number;
    limit: number;
  }
): Promise<{ attempts: number; overLimit: boolean }>;
```

`SlidingWindowTable` is a structural type over the four shared columns (`key`, `windowStartedAt`,
`attempts`, `updatedAt`) so both `taskDropSubscribeRateLimits` and `taskAccessPasswordRateLimits`
satisfy it without either table changing shape. **This function takes the transaction, it does not
open one** — both existing callers already manage their own `db.transaction(...)` (the first to
check two keys, email then client, inside one transaction; the second to check one) — preserve that
caller-owned-transaction structure exactly, don't have the shared function open its own. The window
duration is parameterized as `windowSeconds` (both existing callers pass `60 * 60` for their
existing 1-hour window) — parameterize the SQL's `INTERVAL` via a bound query parameter (e.g.
`sql`CURRENT_TIMESTAMP - (${params.windowSeconds} || ' seconds')::interval`` or equivalent drizzle
construction), not string concatenation, so this stays a safe bound parameter, not a raw-SQL
injection risk. The function returns the raw `{ attempts, overLimit }` — it does **not** throw;
each caller keeps throwing its own existing, differently-shaped error (`TRPCError` vs. plain
`Error`), preserving today's exact behavior and error contracts for both features' existing callers
(and their existing tests, which assert on those specific error shapes).

**Zero behavior change is the hard constraint for both migrations**: same window (1 hour), same
per-key limits (3/10/10), same table names and columns (no migration/schema change — the shared
function reads/writes the same existing tables, it doesn't introduce new ones), same error types
and messages thrown by each caller. This is a refactor of *how the SQL gets constructed*, not a
change to *what either feature does*. If the migration surfaces a real reason to change a limit,
window, or error shape, that's a new, separate decision — raise it, don't fold it in silently here.

`enforceTaskDropSubscribeRateLimit` and `enforceTaskAccessPasswordRateLimit` keep their own exact
exported signatures — callers of those two functions (wherever they're invoked from today) need no
changes. Only their internal SQL construction is replaced with a call to
`consumeSlidingWindowAttempt`.

### The constant

In `apps/backend/src/config/payments.ts`, alongside `FREE_SUBMISSION_ALLOWANCE`:

```ts
/**
 * Implements: ADR-0037
 * Tier 2 hard ceiling (RFC-0006): the absolute maximum successful submissions a worker may
 * make to a single bounty/benchmark task, regardless of Tier 1 pricing. Per (worker, task) --
 * see ADR-0037 for why this is explicitly not platform-wide or cross-task.
 */
export const HARD_SUBMISSION_CEILING = 100;
```

No env override is needed for this constant the way `FREE_SUBMISSION_ALLOWANCE` has one.
`scripts/cloud-env-setup.sh` sets `SUBMISSION_FREE_ALLOWANCE=1000` for the smoke/sandbox
environment specifically so smoke runs don't trip Tier 1's paid path — but that override raises
the *free allowance*, not any ceiling, and the hard ceiling of 100 is independent of it. Checked
directly (not assumed): the two smoke scripts that loop over repeat submissions,
`apps/backend/src/scripts/smoke-submission-integrity.ts` (loop at line 292, 20 iterations) and
`apps/backend/src/scripts/smoke-submission-visibility.ts` (loop at line 105, 20 iterations), both
submit far fewer than 100 times to any single task — well clear of the hard ceiling. Re-verify
this with a fresh grep (`grep -rn "for (let i = 0" apps/backend/src/scripts/smoke-*.ts`) before
landing this spec's code, in case a smoke script has grown a longer loop since this was checked —
if any smoke script's submission loop reaches 100, it will start failing against the hard ceiling
regardless of `SUBMISSION_FREE_ALLOWANCE`, and that script's loop count (not the hard ceiling)
should be reduced. Do not add a `HARD_SUBMISSION_CEILING` env override to route around this —
the whole point of Tier 2 is that the ceiling doesn't move.

### Where the check runs

`apps/backend/src/middleware/submissionAllowanceGate.ts` currently has two branches: within the
free allowance → `next()`; over it → `x402Middleware`. Add a third, checked first:

```
task lookup
  → mode not metered → next() [unchanged]
  → mode metered:
      over hard ceiling → 429, do not call next() or x402Middleware [NEW]
      within free allowance → next() [unchanged]
      over free allowance, under hard ceiling → x402Middleware [unchanged]
```

The hard-ceiling check must run **before** the free-allowance check (checking "is this submission
even allowed at all" before "does it need to be paid for") — a submission at or past the ceiling is
rejected regardless of whether it would otherwise have been free or paid.

### Failure response

No existing precedent in this file for a hard block (Tier 1 only ever falls through to `next()` or
`x402Middleware`, never terminates the request itself) — but the codebase's own Express-error
convention is consistent elsewhere in this same file's neighbors: `res.status(N).json({ error:
'<message>' })` (see `x402.ts`'s `X402PreflightError` handling, `validateBody.ts`). Use HTTP `429
Too Many Requests`, matching the semantics already used for rate-limit-shaped rejections elsewhere
in this codebase (`TRPCError({ code: 'TOO_MANY_REQUESTS', ... })` in
`task-drop-subscribe-rate-limit.ts` and `task-access-password.ts` — this is an Express route, not
tRPC, so the HTTP status is the direct equivalent, not the tRPC error code):

```ts
return res.status(429).json({
  error: 'This task has reached its maximum number of submissions from this worker.',
});
```

Do not construct or call `x402Middleware` at all on this path — the point is to reject outright,
not to offer a paid path past the ceiling.

### Fail-open vs. fail-closed

Tier 1's task-lookup failure path fails open (`next()`, unmetered) because that route had no gate
at all before RFC-0006 — an internal error shouldn't silently start charging someone. The hard
ceiling is different: it is a safety bound, not a pricing convenience. If the task lookup itself
fails, the existing Tier 1 fail-open behavior already applies (this spec doesn't change that
branch) — but once the task lookup succeeds and the mode is confirmed metered, the hard-ceiling
count read must itself fail closed (reject with 429) rather than open, if that specific query
fails. Reuse the same DB-backed count Tier 1 already trusts; do not add a second, separate failure
mode for this one query that Tier 1's own doesn't have to worry about.

### CLI: structured status on the existing JSON error envelope

**Correction (2026-07-31, before implementation began)**: an earlier draft of this section
proposed throwing a bare `Error(result.error)` string, framing the problem as "the CLI prints raw
JSON instead of a clean message." That framing was wrong. Checked directly:
`apps/cli/src/index.ts`'s top-level `program.parseAsync(...).catch(...)` already wraps *every*
uncaught error — from `apiPost` or anywhere else — into this repo's one standardized CLI output
envelope: `process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n')`,
exit code 1. `apps/cli/src/lib/output.ts`'s `printError` produces the identical shape for
in-command validation errors. This envelope is a documented, agent-facing contract (`apps/docs/src/
public/skill.md`: "CLI errors are JSON on stderr and exit with code 1: `{ "ok": false, "error":
"..." }`") — the CLI is agent-native and always returns JSON, on success and on failure alike. So
the output was never plain text; the actual gap is that the envelope carries no HTTP status
today, just a prose `error` string that happens to have the status number embedded inside it
(`apiPost`'s current `Error('POST ${path} failed (${res.status}): ${JSON.stringify(result)}')`) —
useful for a human reading a log, useless for an agent trying to branch on "was this a 429 versus
a 500" without parsing the message text.

**Actual fix**: add a `status` field to the existing envelope, sourced from the real HTTP status,
not parsed out of a string. Add a small `ApiError` class to `apps/cli/src/lib/api.ts`:

```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
```

`apiPost`/`apiGet`/`apiDelete` throw `new ApiError(res.status, message)` on a non-2xx response
instead of a bare `Error`. `message` stays exactly what it is today (the existing `POST ... failed
(...): {...}` wrapped string) — this fix is additive, not a rewording of the message text itself.
`apps/cli/src/index.ts`'s top-level catch special-cases `ApiError` to include `status` in the
envelope:

```ts
program.parseAsync(process.argv).catch((err: Error) => {
  const status = err instanceof ApiError ? err.status : undefined;
  process.stderr.write(JSON.stringify({ ok: false, error: err.message, ...(status !== undefined ? { status } : {}) }) + '\n');
  process.exit(1);
});
```

Result for the hard-ceiling case specifically:

```json
{ "ok": false, "error": "POST /api/tasks/0x.../submissions/from-keys failed (429): {\"error\":\"This task has reached its maximum number of submissions from this worker.\"}", "status": 429 }
```

Still JSON, still the same standardized envelope, still exit code 1 — now with a real, parseable
`status` an agent can branch on (e.g. "429 means stop retrying this task") without string-matching
the `error` text. `submit.ts` needs no change of its own — the improvement is at the shared
`apiPost`/top-level-catch layer, so every CLI command benefits, not just `submit`. `printError`
(direct validation errors with no HTTP status behind them, e.g. `--file is required`) is
unaffected — it correctly omits `status` since there isn't one.

**Explicitly do not** add retry-on-429 logic to `apiPost`. `apps/cli/src/lib/xmtp-client.ts`
already retries on 429 for an unrelated subsystem (XMTP messaging backoff) — that pattern does not
apply here. A 429 from the hard ceiling is permanent for that `(worker, task)` pair; retrying it
will never succeed and would just spam the backend. If a future change adds retry logic to
`apiPost` for some other reason, it must not retry on 429.

## Interfaces / Contracts

```ts
// apps/backend/src/lib/rate-limit.ts
export async function isOverFixedCeiling(
  database: Database,
  params: { count: () => Promise<number>; ceiling: number }
): Promise<boolean>;

export async function consumeSlidingWindowAttempt(
  tx: Transaction,
  params: { table: SlidingWindowTable; key: string; windowSeconds: number; limit: number }
): Promise<{ attempts: number; overLimit: boolean }>;

// apps/backend/src/services/submission-allowance.ts
export async function isOverHardSubmissionCeiling(
  database: Database,
  taskId: string,
  workerAddress: string
): Promise<boolean>;

// apps/backend/src/config/payments.ts
export const HARD_SUBMISSION_CEILING: number; // 100
```

`submissionAllowanceGate`'s own exported signature (`SubmissionAllowanceGateOptions`,
`RequestHandler`) does not change — this is an internal addition to the existing gate, not a new
route or a new middleware factory. `enforceTaskDropSubscribeRateLimit`'s and
`enforceTaskAccessPasswordRateLimit`'s own exported signatures (`apps/backend/src/services/
task-drop-subscribe-rate-limit.ts`, `apps/backend/src/lib/task-access-password.ts`) do not change
either — only their internal implementation migrates onto `consumeSlidingWindowAttempt`.

```ts
// apps/cli/src/lib/api.ts
export class ApiError extends Error {
  readonly status: number;
}
```

`apiPost`/`apiGet`/`apiDelete` now throw `ApiError` instead of a bare `Error` on a non-2xx
response — a strictly additive change (`ApiError extends Error`, existing `catch (err: Error)`
call sites keep working unchanged). The CLI's stderr JSON envelope (`{ ok: false, error, status? }`
— see "CLI: structured status" above) gains an optional `status` field; the documented `{ ok:
false, error: "..." }` shape from `skill.md` is a subset of the new shape, so this is additive to
the documented contract too, not a breaking change to it. No new CLI flag, command, or option is
introduced.

### Public documentation

The user-facing docs site (`apps/docs`) has no page describing submission rate limits at all today
— add one now that both tiers exist, following the existing `apps/docs/src/pages/features/`
convention exactly (see `visibility.md` in that directory for the house style: frontmatter
`description`, `# Title`, plain prose, no jargon, a `***` divider between sections). New file:
`apps/docs/src/pages/features/submission-rate-limits.md`. Content it must cover, in plain terms (no
internal file paths, no ADR/RFC references — this page is for external readers):

- Bounty/benchmark submissions: the first 5 from a given worker to a given task are free; after
  that, each one from that worker costs 0.001 USDC.
- A hard maximum of 100 submissions from a given worker to a given task, after which no further
  submissions are accepted from that worker to that task, paid or not.
- Both limits are per `(worker, task)` pair — not shared across workers on the same task, not
  shared across a worker's other tasks, and not a platform-wide total. Each worker gets their own
  free allowance and hard maximum on every task; a worker can reach the maximum on one task and
  still submit freely to others.
- Claim, pitch, and auction submissions are not subject to either limit.

Do not invent numbers or claims beyond what's actually implemented — if the exact wording of the
429 error message changes during implementation, update this page to match, not the other way
around.

### Agent skill docs

`apps/backend/skill.md` is a symlink to `apps/docs/src/public/skill.md` (confirmed by `ls -la`) —
that file is the single canonical source, served live at `/skill.md` by the backend
(`apps/backend/src/app.ts`) and exported into the skill package by `scripts/export-skills-market.mjs`.
`apps/docs/src/pages/skill.md` is a separate, currently byte-identical copy used to render the docs
site page — edit both files identically; there is no automated sync today, so a diff between them
after this change is a mistake, not a stylistic choice.

Add a short paragraph to both files' submission-related section (near the existing `taskmarket
task submit` guidance, around the `submissionWindowOpen` / mode-table area) stating, in the same
terse, agent-facing register as the rest of the file (see e.g. the existing
`--submission-visibility` bullet for the register to match):

- Bounty/benchmark submissions: the first 5 from this worker to a task are free; each one after
  that requires an X402 payment of 0.001 USDC, handled automatically by the CLI's existing X402
  flow — no special agent handling needed for the paid path itself.
- A hard maximum of 100 submissions from this worker to any one task. Past that, `task submit`
  fails with the CLI's standard `{ "ok": false, "error": "...", "status": 429 }` envelope (see
  "CLI: structured status on the existing JSON error envelope" above) — this is permanent for that
  task, not something to retry. An agent that hits this should check for `status === 429`, stop
  submitting to that task, and report the limit to its operator rather than retrying.
- Both limits are per `(worker, task)` pair — not shared with other workers submitting to the same
  task, not shared across this worker's other tasks, and not a platform-wide total.

Do not restate the exact dollar amount or numbers if `apps/docs/src/pages/features/
submission-rate-limits.md` and this file could drift — both are written from the same real
constants (`FREE_SUBMISSION_ALLOWANCE`, `HARD_SUBMISSION_CEILING`), so keep the phrasing
consistent between them and update both together if either number ever changes.

### Changeset

**Applicable — patch bump on the CLI, not the backend.** `apps/backend` is `"private": true`, so
the backend-side change (the hard ceiling itself) needs no changeset entry on its own — that part
of the earlier "not applicable" reasoning still holds. But the CLI's structured-status change (see
"CLI: structured status on the existing JSON error envelope" above) touches
`@lucid-agents/taskmarket` (`apps/cli/package.json`, currently `1.7.2`), a published package, so
it does need one. Add `.changeset/<generated-name>.md`:

```markdown
---
"@lucid-agents/taskmarket": patch
---

API error responses now include a `status` field alongside `error` in the CLI's standard JSON
envelope (`{ "ok": false, "error": "...", "status": 429 }`), so an agent can branch on the HTTP
status instead of string-matching the error message — for example, distinguishing a rate-limit
rejection from a server error.
```

`patch`, not `minor` — this adds an optional field to the existing, documented JSON envelope
without changing its required shape or any command's existing behavior; nothing that parsed the
old `{ ok, error }` shape breaks. Match the format of prior changesets exactly (see
`.changeset/tidy-cli-private-task-hint.md` in git history, `git show <sha>:.changeset/
tidy-cli-private-task-hint.md`, for a real precedent of the same patch-bump, one-paragraph shape).

## Security & Privacy considerations

No new surface beyond what Tier 1 already established: `workerAddress` is read from an
unauthenticated request field for the count check only, never trusted for identity, and the count
itself is read-only (no write happens from this check, so nothing can be "burned" by a spoofed
address, same reasoning as Tier 1's own).

## Testing & Verification

Add a new `apps/backend/test/unit/lib/rate-limit.test.ts`:

1. `isOverFixedCeiling` is `false` below the ceiling.
2. `isOverFixedCeiling` is `true` at exactly the ceiling.
3. `isOverFixedCeiling` is `true` above the ceiling.
4. `isOverFixedCeiling` calls `count()` exactly once per invocation (it's the only DB access — a
   regression here would mean a query per submission that shouldn't be there).
5. `consumeSlidingWindowAttempt` returns `{ attempts: 1, overLimit: false }` on a fresh key.
6. `consumeSlidingWindowAttempt` increments `attempts` and returns `overLimit: false` on repeated
   calls within the window, up to and including exactly `limit`.
7. `consumeSlidingWindowAttempt` returns `overLimit: true` on the call that pushes `attempts` past
   `limit`, within the window.
8. `consumeSlidingWindowAttempt` resets `attempts` to `1` and `overLimit: false` on a call after
   `windowSeconds` has elapsed since `windowStartedAt` — the reset behavior, not just the counting.
9. `consumeSlidingWindowAttempt` used against two different `table` values (a fake/test table
   fixture, or both real tables in an integration-style test) confirms the `table` parameter
   actually targets the right table, not a hardcoded one.

Add to `apps/backend/test/unit/services/submission-allowance.test.ts`:

10. `isOverHardSubmissionCeiling` delegates to `isOverFixedCeiling` with `HARD_SUBMISSION_CEILING`
    and `countSuccessfulSubmissions(database, taskId, workerAddress)` as the count source — a thin
    wrapper test, not a re-test of the 3 boundary cases already covered above.

Add to `apps/backend/test/unit/middleware/submissionAllowanceGate.test.ts`:

11. At/over the hard ceiling: responds `429` with a JSON `{ error: ... }` body, `next()` is never
    called, `x402Middleware` is never constructed or invoked.
12. Under the hard ceiling but over the free allowance: still routes to `x402Middleware`, unchanged
    from Tier 1's existing test coverage — confirms the new check doesn't regress the existing paid
    path.
13. Under the free allowance: still bypasses to `next()` directly, unchanged — confirms the new
    check doesn't regress Tier 1's free path.
14. Non-metered task mode (claim/pitch/auction): still unmetered, unchanged — the hard ceiling must
    not apply outside bounty/benchmark either.

`apps/backend/test/unit/services/task-drop-subscribe-rate-limit.test.ts` and
`apps/backend/test/unit/lib/task-access-password.test.ts` (both already exist): run unmodified
after the migration and must still pass unchanged — this is the actual proof of "zero behavior
change," not the new `rate-limit.test.ts` cases above, which only test the shared function in
isolation. If either existing test needs to change to keep passing, the migration introduced a
real behavior change and that's a bug in the migration, not a test to "fix."

Add to (or find the existing equivalent of) `apps/cli/test/unit/lib/api.test.ts`:

15. `apiPost` on a non-2xx response throws an `ApiError` (`instanceof ApiError` and `instanceof
    Error` both true), with `.status` set to the response's real HTTP status (e.g. `429`) and
    `.message` unchanged from today's existing wrapped-string content.
16. Same for `apiGet` and `apiDelete` — all three must throw `ApiError`, not a plain `Error`, so
    the top-level catch's `status` extraction works regardless of which one failed.

Add to (or find the existing equivalent of) a CLI top-level/index test:

17. Given an `ApiError` with `.status = 429` thrown from inside a command action,
    `program.parseAsync(...).catch(...)` writes `{ ok: false, error: <message>, status: 429 }` to
    stderr and exits with code 1.
18. Given a plain `Error` (no `.status`) thrown from inside a command action, the same catch
    writes `{ ok: false, error: <message> }` — no `status` key present at all, not `status:
    undefined` serialized into the JSON (confirm via `JSON.parse(stderrOutput)` and checking
    `'status' in parsed`, not just that the value is falsy).

Smoke suite (manual/CI check, not a new automated test): re-run the grep from "The constant" above
against the current `apps/backend/src/scripts/smoke-*.ts` before merging, confirming no script's
submission loop has grown to reach 100 iterations against a single task since this spec was
written.

### Validation commands

```bash
make test backend
make type-check backend
make test cli
make type-check cli
make lint-check specs
grep -rn "for (let i = 0" apps/backend/src/scripts/smoke-*.ts
```

`make type-check cli` requires a `cli` branch in the Makefile's `type-check` dispatch — add it
first if it isn't already there (`elif [ "$(word 1,$(ARGS))" = "cli" ]; then cd apps/cli && pnpm
type-check; \`, mirroring the existing `backend`/`email-worker` branches). `make test cli` already
works without changes — `test`'s own dispatch is generic over any `apps/<name>` directory.

### Definition of done

1. `apps/backend/src/lib/rate-limit.ts` created, exporting `isOverFixedCeiling` (filename/exact
   parameter shape per ADR-0038's "subject to normal implementation judgment" note), unit-tested
   (cases 1-4 above).
2. `consumeSlidingWindowAttempt` added to the same file, unit-tested (cases 5-9 above).
3. `isOverHardSubmissionCeiling` implemented in `submission-allowance.ts` as a thin wrapper over
   `isOverFixedCeiling`, unit-tested (case 10 above).
4. `enforceTaskDropSubscribeRateLimit` and `enforceTaskAccessPasswordRateLimit` migrated onto
   `consumeSlidingWindowAttempt`, exported signatures unchanged, both existing test files
   (`task-drop-subscribe-rate-limit.test.ts`, `task-access-password.test.ts`) pass unmodified —
   zero behavior change confirmed, not assumed.
5. `submissionAllowanceGate` checks the hard ceiling before the free-allowance check, returns 429
   without calling `next()` or `x402Middleware` when over it, and all 4 middleware test cases
   (11-14 above) pass alongside the existing Tier 1 tests (no regressions).
6. `apps/docs/src/pages/features/submission-rate-limits.md` written, following the `features/`
   directory's existing style.
7. `ApiError` class added to `apps/cli/src/lib/api.ts`; `apiPost`/`apiGet`/`apiDelete` throw it
   with the real HTTP status on any non-2xx response; the top-level catch in
   `apps/cli/src/index.ts` includes `status` in the JSON envelope only when the caught error is an
   `ApiError` (never `status: undefined` in the serialized output); all 4 new test cases (15-18
   above) pass. No retry-on-429 added.
8. `apps/docs/src/public/skill.md` and `apps/docs/src/pages/skill.md` both updated, identically,
   with the submission-economics paragraph, mentioning the `status` field an agent can check.
9. `.changeset/<name>.md` added: `"@lucid-agents/taskmarket": patch`, describing the new `status`
   field on the JSON error envelope (see Changeset above for the exact shape).
10. `git add` the new/changed files, then run `pnpm --filter @taskmarket/adr run adr-audit` — this
    spec's own `Implements ADRs: ADR-0037, ADR-0038` reference should make both compute as at
    least `Specified`; once the code lands with real `Implements:`/`Verifies:` back-pointers (on
    `rate-limit.ts` for ADR-0038 — both functions, plus the migrated call sites in
    `task-drop-subscribe-rate-limit.ts`/`task-access-password.ts` — and on
    `submission-allowance.ts`/`submissionAllowanceGate.ts` for ADR-0037), both should compute as
    `Implemented` or `Verified`. Update both ADRs' own `Embodiment` fields to match — do not leave
    either at `Not started` once real evidence exists (see the harness's own hook, which will
    otherwise flag exactly this mismatch).
11. `adr-audit`: 0 drift. `adr-lint`: 0 errors. `make lint-check specs`: 0 errors.
12. Backend: `tsc --noEmit` clean, full `apps/backend` unit suite passing, zero regressions.
13. CLI: `tsc --noEmit` clean, full `apps/cli` unit suite passing, zero regressions.
14. Smoke-suite grep check (Testing & Verification above) run and confirmed clean before merge.
15. Issue #372 closed with a comment pointing at this spec and ADR-0038 as where its scope landed.

## Non-goals

- **Not** a polished failure UX (RFC-0006 Open Question 4). This spec now includes a minimal CLI
  fix (add structured `status` to the existing JSON error envelope — see "CLI: structured status")
  because that's a small, directly-related correction, not the open question's full scope. Still
  explicitly out: any `apps/web` (frontend) changes, a distinct exit code or richer per-error-type
  `--json` shape beyond the single new `status` field, or any "you have N submissions left"
  pre-warning before the limit is hit. Open Question 4 stays open for that larger work.
- **Not** platform-wide or cross-task rate limiting (a single worker's total volume across every
  task, or a platform-wide cap) — RFC-0006's own "Future ideas" section already records these as
  deliberately deferred, distinct ideas from either the fixed-ceiling or time-windowed mechanisms
  this spec builds.
- **Not** PR #369's own implementation — the review found a real gap (benchmark's optional
  submissions channel, metered here, had no frontend review surface at all) and that fix landed
  directly on PR #369's branch (`docs/specs/worker-grouped-submission-review.md` Milestone 5,
  commit `59df9279`), not in this spec. This spec's own scope is unchanged by that finding — see
  "Relationship to PR #369" note below for what the review actually found.
- **Not** an appeal or override path for a worker who hits the ceiling — out of scope; if this
  becomes a real operational problem, it needs its own RFC/ADR, not a quiet addition here.
- **Not** changing either existing limiter's window duration, per-key limits, or error shape as
  part of the migration — see "Migrating the existing rate limiters" above; any such change is a
  separate decision, not silently bundled into a refactor.

## References

- RFC: `docs/rfc/0006-submission-spam-free-allowance-pricing.md`
- ADR-0035 (Tier 1 mechanism), ADR-0036 (Tier 1 allowance size)
- ADR-0037 (this spec's policy decision: ceiling = 100, per-task)
- ADR-0038 (this spec's mechanism decision: one shared `rate-limit.ts` module, two functions —
  fixed-ceiling for Tier 2, time-windowed for the two migrated limiters)
- `apps/backend/src/lib/rate-limit.ts` (new — both shared functions)
- `apps/backend/src/services/submission-allowance.ts` (extended, not replaced — thin wrapper over
  `rate-limit.ts`)
- `apps/backend/src/middleware/submissionAllowanceGate.ts` (extended, not replaced)
- `apps/backend/src/config/payments.ts` (new constant, alongside the existing Tier 1 one)
- `apps/backend/src/services/task-drop-subscribe-rate-limit.ts`,
  `apps/backend/src/lib/task-access-password.ts` (migrated onto `rate-limit.ts`'s time-windowed
  function; exported signatures and observed behavior unchanged)
- `apps/backend/src/db/schema.ts` (`taskDropSubscribeRateLimits`, `taskAccessPasswordRateLimits` —
  unchanged table schemas, read/written by the migrated code)
- `apps/docs/src/pages/features/visibility.md` (style precedent for the new public docs page)
- `apps/cli/src/lib/api.ts` (`ApiError`, structured-status fix), `apps/cli/src/lib/xmtp-client.ts`
  (precedent for 429 handling elsewhere — explicitly not reused here, see "CLI: structured status")
- `apps/docs/src/public/skill.md` (canonical agent skill doc, symlinked from `apps/backend/
  skill.md`), `apps/docs/src/pages/skill.md` (docs-site copy, update identically)
- `scripts/cloud-env-setup.sh` (sets `SUBMISSION_FREE_ALLOWANCE=1000` for smoke/sandbox — the
  reason the smoke-suite ceiling collision was checked)
- `.changeset/tidy-cli-private-task-hint.md` (git history — format precedent for this spec's new
  changeset entry)
- Issue #372 (closed by this spec — its scope is fully covered here and in ADR-0038, not left open
  with an updated description)
