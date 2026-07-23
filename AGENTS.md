# Taskmarket

## Commands

Run all project commands through the Makefile. Run `make` to see available commands. Do not use emojis anywhere in the codebase.

## Codebase Patterns

When implementing features, follow established patterns in these guides:

**Backend**: tRPC routers, Drizzle schema, service layer (docs/BACKEND_GUIDE.md)
**Frontend**: Components, routing, tRPC client, wallet integration (docs/FRONTEND_GUIDE.md)
**CLI**: Command structure, wallet operations (docs/CLI_GUIDE.md)
**Smart Contracts**: Solidity patterns, testing, deployment (docs/CONTRACTS_GUIDE.md)
**Database**: Drizzle schema definition, migrations (docs/DB_GUIDE.md)
**Testing**: Unit tests, integration tests (docs/TESTING_GUIDE.md)

## Design Decisions: RFCs and ADRs

Pre-decision design proposals live in `docs/specs/` (RFCs). Decided architectural or
hard-to-reverse decisions are recorded in `docs/adr/` (ADRs) — see `docs/adr/README.md` for
the process. An ADR requires explicit human approval before its status becomes `Accepted`; an
agent may draft one but may not self-approve it. If you are working a task unattended and hit
a decision that belongs in an ADR, stop and draft one instead of deciding unilaterally.

## Repository Structure

- apps/backend - Express + tRPC backend (docs/BACKEND_GUIDE.md)
- apps/web - Production Next.js App Router web app (docs/FRONTEND_GUIDE.md)
- apps/cli - Commander.js CLI (docs/CLI_GUIDE.md)
- apps/docs - Vocs public documentation site
- packages/shared - Shared types, Zod schemas, utilities
- packages/contracts - Solidity smart contracts (docs/CONTRACTS_GUIDE.md)
- packages/eslint-config - Shared ESLint rules
- packages/prettier-config - Shared Prettier rules
- packages/markdownlint-config - Shared markdownlint rules
- packages/remark-config - Shared remark rules
- packages/markdown-link-check-config - Shared link check rules
- docs/ - Internal developer documentation

## Docs: Agent Skill Files vs Human Docs

`apps/docs/src/public/` and `apps/docs/src/pages/` both contain markdown, but they are served differently by Vocs and exist for different audiences:

- `apps/docs/src/public/` -- raw files served as-is at their literal path (e.g. `docs.taskmarket.dev/reference/rewards.md`), no rendering, no sidebar nav. This is the **agent-facing skill bundle**: `reference/skill-manifest.txt` is the authoritative list of every file in it, and `skill.md` is the entrypoint an agent loads first, referencing the other files on demand (e.g. "Load evaluators.md for evaluator/dispute flows"). Anything installed via the Taskmarket skill installer reads from here.
- `apps/docs/src/pages/` -- compiled into rendered HTML pages with sidebar navigation at `docs.taskmarket.dev/<path>` (no `.md` suffix). This is the **human-facing docs site**.

`apps/docs/src/pages/reference/`, `apps/docs/src/pages/modes/`, `apps/docs/src/pages/examples/`, and `apps/docs/src/pages/skill.md` are duplicated copies of the corresponding `public/` files, kept only so humans browsing the site can find and read them via the sidebar. `public/` stays the source of truth for what agents/the CLI actually fetch.

### Workflow

Any time you add or edit a file under `public/reference/`, `public/modes/`, `public/examples/`, or `public/skill.md`:

1. Make the same edit to the matching file under `pages/` (same relative path, e.g. `public/reference/rewards.md` <-> `pages/reference/rewards.md`).
2. If it's a new file, also add a sidebar entry for it in `apps/docs/vocs.config.ts` (under the matching `Task Mode Specs`, `Reference`, `Examples`, or `Agent Skill` section) -- a page with no sidebar entry is unreachable by a human even though it renders.
3. Run `pnpm --filter @taskmarket/docs lint:check` and `pnpm --filter @taskmarket/docs build` before committing -- the `pages/` copy is linted (markdownlint, remark) and prerendered at build time; the `public/` copy is not, so issues only surface on the `pages/` side.

`skill-manifest.txt` is the one exception: it is an index of the `public/` bundle, not content, and stays `public/`-only. New agent-facing content files should not be added to only one side without a specific reason.

## Writing Code

- Do not use emojis anywhere -- code, comments, commit messages, strings, documentation
- Match the style and formatting of surrounding code
- Prefer simple solutions over clever ones
- Follow existing patterns in the guides above before inventing new ones

## Frontend/UI Changes: Run `make ui-ci` Before Pushing

Any `apps/web` UI change must pass `make ui-ci` (run `make ui-ci-install-browsers` once first)
before pushing; if that's not feasible, check the PR's `ui` CI job before calling it done.

## Smoke Tests

Smoke tests live in `apps/backend/scripts/smoke-*.ts` and run against a live backend + deployed contract. Run with `make smoke <name>` (e.g. `make smoke bounty`, `make smoke evaluator`).

`make smoke sandbox` is different: it builds and runs `scripts/sandbox.Dockerfile`, which runs `scripts/cloud-env-setup.sh` inside a real Linux container end to end (including the native-Postgres install path that can't run on macOS), then runs `make smoke bounty` inside it against the stack it just provisioned.

**If you're a cloud agent (Claude Code cloud, Codex cloud), run `./scripts/cloud-env-setup.sh` yourself as your first action, before doing anything else -- do not assume a vendor's own setup mechanism already brought the stack up for you.** This is a deliberate, documented boundary in at least one vendor (Codex): its "Setup script" runs in a separate bash session from the one the agent actually works in, with no way for background processes (Postgres, Anvil, the backend, the facilitator) to survive across that boundary -- it is not a bug or something to work around, it exists because setup gets full network trust and the agent phase deliberately does not. The script is idempotent (safe to run again -- it detects what's genuinely still up versus what needs (re)starting), and it is exactly as fast the second time since the one-time work (toolchain, submodules) gets skipped; only the actually-ephemeral pieces (Anvil has no persisted chain state, so contracts always redeploy fresh) redo their work. If a `make` target still fails with `ECONNREFUSED 127.0.0.1:3000` (or similar) after that, re-run the script once more and retry before concluding anything is actually broken.

### When to write a smoke test

Write or update a smoke test whenever you:
- Add a new on-chain function (every new facet function needs at least one path)
- Add a new CLI command that triggers an on-chain action
- Fix a bug caused by an untested state transition

### What every smoke test must cover

Cover every meaningful branch, not just the happy path:

- **All terminal states**: accepted, rejected, cancelled, expired, disputed — each is a distinct code path
- **All actor roles**: requester, worker, evaluator, dispute resolver — each has separate auth checks
- **Error paths**: what should be rejected (wrong role, wrong status, wrong inputs) — assert the error, not just that the happy path works
- **Status transitions**: poll for each expected status after each on-chain call — do not skip intermediate states
- **Multi-party flows**: if a flow needs two workers (e.g. ranked payout, competitive auction), use two accounts — never use the same address twice as distinct parties

### Accounts

- `REQUESTER_PRIVATE_KEY` — task creator / requester
- `WORKER_PRIVATE_KEY` — primary worker
- `WORKER_B_PRIVATE_KEY` — second worker (required for ranked-payout, optional for competitive auction). Any freshly generated key works — the backend's `SERVER_PRIVATE_KEY` relays and pays gas for every on-chain call via the forwarder, so worker/requester keys only ever sign off-chain EIP-712 messages and never need ETH or USDC of their own.
- `EVALUATOR_PRIVATE_KEY` — external evaluator (optional; requester can act as evaluator if not set)
- `DEV_PRIVATE_KEY` — fallback if specific keys not set

### Verifying contract facts before writing

Before writing assertions about contract behavior, read the relevant facet source in `packages/contracts/src/facets/`. Do not trust comments or descriptions in existing smoke tests — verify directly against the Solidity. In particular:
- Check which status checks gate each function (`task.status != ...`)
- Check which role checks gate each function (`msg.sender != task.requester` etc.)
- Check whether an endpoint is permissionless (no X402 needed) or payer-gated

### X402 vs plain POST

- Use `x402Post(path, body, account)` for any endpoint that checks `ctx.res.locals.payer` — these require X402 payment
- Use `post(path, body)` for permissionless endpoints (e.g. `finalizeVerdict`, public GETs)
- When in doubt, check the router: if it throws on missing `payer`, it needs `x402Post`

## Smart Contract CI Requirements

After any change to contract source files (`packages/contracts/src/`), always regenerate the gas snapshot before committing:

```
cd packages/contracts && forge snapshot
```

CI runs `forge snapshot --check` and fails if the snapshot is stale. This is a frequent source of CI failures — do not skip it.

## Database Migrations

Every new migration file (`apps/backend/drizzle/migrations/NNNN_*.sql`) must have a matching entry appended to `apps/backend/drizzle/migrations/meta/_journal.json`. A `.sql` file with no journal entry is invisible to the runtime migrator (`drizzle-orm`'s `migrate()`, called on every backend boot in `apps/backend/src/server.ts`) — it will never be applied, and it fails silently with no error at startup or in most tests. The first sign of trouble is usually a "relation does not exist" error much later, e.g. in a smoke test.

When adding a migration by hand (rather than via `pnpm db:generate`, which updates the journal automatically but requires an interactive prompt this repo's history makes awkward — see below), add a new entry to the `entries` array in `meta/_journal.json`:

```json
{
  "idx": <next sequential integer>,
  "version": "7",
  "when": <a timestamp STRICTLY GREATER than every existing entry's "when" AND greater than whatever the target database's last-applied migration timestamp actually is>,
  "tag": "NNNN_your_migration_name",
  "breakpoints": true
}
```

The `"when"` value is not cosmetic — the migrator's only gating logic is `lastAppliedMigration.created_at < migration.when`, compared against whatever is actually already recorded in the target database, not against the other entries in this file. Local dev databases in this repo often have migrations from other branches applied to them, so their latest recorded timestamp can be newer than you'd expect from this file's own sequence. Use current wall-clock epoch millis (`date +%s000`) rather than incrementing the previous entry's value — it's guaranteed to be greater than any database's history.

`make release` has a guard that checks `.sql` file count against journal entry count and refuses to release if they're out of sync — but nothing else in this repo (tests, CI, `make db:migrate`) catches a missing journal entry before that point, so don't rely on it as your only check.

### Before merging a branch that adds migrations

A present journal entry is not enough on its own — its `"when"` value can still be stale relative to what already merged into `main` while the branch was open, and the migrator will silently skip it with no error (this has happened in production: see the `task_drop_id` incident, where a long-lived branch's `0024`/`0025` entries had `"when"` timestamps older than a `0024`-named migration that had meanwhile shipped to `main` and production — both got skipped on every subsequent boot until the timestamps were fixed).

Before merging or deploying any branch that adds new migration files:
- Read `apps/backend/drizzle/migrations/meta/_journal.json` on `main` at the tip you're merging into, not just on your branch, and confirm your new entries' `"when"` values are greater than every entry already there — not just greater than your own branch's prior entries.
- If your branch was cut before other migrations landed on `main`, re-timestamp your entries with a fresh `date +%s000` right before merging, don't reuse timestamps generated when the branch was created.
- After deploying, check the backend boot logs for migration errors, and independently confirm the new tables/columns actually exist in the target database (e.g. `\d tasks` in psql) — don't infer success just from an absence of errors, since a skipped migration fails silently.

`apps/backend/test/unit/config/migrations-journal.test.ts` runs these ordering checks (sequential `idx`, strictly increasing `when`, `.sql`-file/journal-entry count parity) automatically on every test run — it would have caught the `task_drop_id` incident above without anyone needing to remember the manual checklist.

### Migration SQL must be idempotent

Write every migration statement so that re-running it against a database where it already applied is a safe no-op, not an error:

- `CREATE TABLE "x"` → `CREATE TABLE IF NOT EXISTS "x"`
- `ALTER TABLE "x" ADD COLUMN "y" ...` → `ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" ...`
- `CREATE INDEX "x"` / `CREATE UNIQUE INDEX "x"` → add `IF NOT EXISTS`
- `DROP TABLE|INDEX|COLUMN "x"` → add `IF EXISTS`
- `ALTER TABLE "x" ADD CONSTRAINT "y" ...` has no portable `IF NOT EXISTS` form in this Postgres version — wrap it instead:
  ```sql
  DO $$ BEGIN
    ALTER TABLE "bids" ADD CONSTRAINT "bids_task_worker_unique" UNIQUE ("task_id", "worker_address");
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  ```

`pnpm db:generate` (`drizzle-kit generate`) never adds any of these guards itself — add them by hand after generating, before committing.

This matters because the migrator's gating logic (above) only ever compares a migration's `"when"` against the database's last-applied timestamp — an already-applied migration is skipped purely because its `"when"` is old, not because the migrator remembers having run that specific file. If a `"when"` value for an already-applied migration is ever mistakenly retimed forward (the exact class of mistake the `task_drop_id` incident was, one step removed), a non-idempotent statement re-running will throw (`relation`/`column`/`constraint already exists`) and crash-loop the backend on every subsequent boot, since `server.ts` calls `process.exit(1)` on migration failure. Idempotency guards turn that failure mode into a no-op instead of an outage. `migrations-journal.test.ts` (above) also fails CI if any migration file introduces an unguarded statement, so this is enforced automatically, not just documented here.

## Changesets

Changesets only apply to the CLI package (`apps/cli`, `@lucid-agents/taskmarket`). Do not add a changeset file for changes to any other app or package (backend, web, docs, contracts, shared, etc.) -- only PRs that touch `apps/cli` need one.

Changesets are public, user-facing release notes -- write them for someone learning about the change for the first time, not someone who watched the PR get built.

- **One changeset per PR.** If a PR accumulates multiple changeset files across its commits, consolidate them into a single file before merging.
- **Never describe implementation history.** Words like "replaced X with Y", "switched to", "we changed this because" describe the PR's internal development, not the shipped result -- delete that framing entirely.
- **For a feature that has never shipped to main, describe it as new, not as a change.** If the feature doesn't exist on `main` yet, there is no prior public behavior to compare against. Write "Introduce X" / "Add X", not "X now does Y instead of Z" -- the "instead of Z" reads as if Z was ever live for users, when it never was.
- Reserve before/after framing ("X now supports Y", "Y replaces X") for changes to something that is already live on `main` and that users have actually experienced.

**Semver bump:**
- `minor` -- any new feature (new command, new endpoint, new capability that didn't exist before)
- `patch` -- a change to an existing, already-shipped feature (bug fix, tweak, behavior adjustment)
- `major` -- never use unless the developer explicitly says to. Do not infer a breaking change on your own.

## Smart Contract Storage Layout

The contracts use the Diamond proxy pattern (EIP-2535). All state lives in `AppStorage`, a struct
stored at a fixed `keccak256("taskmarket.appstorage.v1")` slot in `src/libraries/LibAppStorage.sol`.

When adding new state variables:

- **Append only**: new variables must be added at the END of the `AppStorage` struct, never inserted between existing fields
- **No `__gap` needed**: the struct is at a fixed `keccak256` slot; appending is always safe with no slot budget to track
- Never reorder, rename, or remove existing fields between upgrades
- New fields zero-initialise by default; use lazy-init in the facet function body if a non-zero default is needed
