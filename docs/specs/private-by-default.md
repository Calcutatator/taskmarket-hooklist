# Private-by-Default Tasks RFC

Status: Draft, no decision recorded yet
Owner: Taskmarket
Last updated: 2026-07-20

This is an RFC: a design proposal for discussion, not a decision record. Once a direction is
chosen, the decision itself belongs in an ADR under `docs/adr/` (see `docs/adr/README.md`
for the process) — a human must explicitly approve that ADR before it's considered decided.
This document should not be read as already-approved.

## Question this answers

> If we made everything private by default, how much effort would it be?

Short answer: **the data-model and UI work is small (2-3 days); the real cost is a
foundational piece the codebase does not have today -- read-time authentication.**
Every task read endpoint is currently an unauthenticated `publicProcedure`. To make a
task private you must first be able to answer "who is asking?" on a GET request, and
right now the backend cannot. Building that, retrofitting it across ~8 read endpoints,
and reckoning with the fact that core task data is already public on-chain forever, is
what turns a one-column change into a **1.5-3 week** effort depending on scope.

This document scopes the work, names the blocker, and offers two delivery options. In
practice the primary driver is **submission/result privacy**, not task descriptions --
see "Submission visibility and reveal" below for the time-gated, requester-controlled
reveal model. Client-side (platform-blind) encryption is an explicit non-goal for now.

## TL;DR effort verdict

| Scope | What you get | Estimate |
|---|---|---|
| **Phase 1 -- Unlisted** | Tasks hidden from public list/search/SEO, but anyone with the task ID/URL can still view. No read-auth required. | **2-3 days** |
| **Phase 2 -- True private (recommended target)** | Tasks visible only to requester + invited/assigned workers. Requires read authentication. | **1.5-3 weeks** |

The honest recommendation: ship **Phase 1 first** (it removes the loudest privacy
leak -- the public firehose -- cheaply), then decide whether the marketplace product
can tolerate Phase 2, which inverts the core "open marketplace" value proposition.

**On the word "private":** Phase 1 does not build any real access control, so the
recommended near-term implementation exposes only two values -- `unlisted` and
`public` -- not a `private` value. Presenting a `private` option that behaves
identically to `unlisted` (no actual enforcement) would mislead a requester into
believing something is access-restricted when it is not. `private` should only be
added to the schema and surfaced in the CLI/UI once Phase 2's read-authentication
work actually enforces it.

## What "private" can and cannot mean here

A hard constraint shapes everything below: **task core data is stored on-chain and is
public by nature.** The Diamond contract's `AppStorage.tasks` mapping
(`packages/contracts/src/libraries/LibAppStorage.sol`) holds, per task, the `id`,
`requester`, `worker`, `status`, `mode`, `reward`, `expiryTime`, `stakeAmount`, fee,
`deliverable` hash, rating, hook contract, plus a `TaskMetadata` struct with
`contentHash` and `contentURI` (`packages/contracts/src/interfaces/ITMPCore.sol`). All
of it is readable by anyone via an RPC call or block explorer, and emitted in events,
forever. There is no visibility field on-chain and adding one would not help -- the data
is still public.

What lives **off-chain in the database only** (`apps/backend/src/db/schema.ts`, `tasks`
table) and is therefore the only thing we can actually gate:

- the full task `description` text (on-chain stores only its `contentHash`/`contentURI`)
- submission artifacts and file URLs
- pitch/proposal text
- benchmark proof payloads
- feedback / rating text, including the post-completion `rating` recorded per award in
  `task_awards`

So "private by default" precisely means: **the off-chain content and the convenience
discovery surface (list, search, SEO previews, inbox) are gated; the on-chain
existence, reward, and metadata of a task remain publicly observable.** This is an
acceptable and common Web3 privacy posture, but it must be stated plainly in product
copy so we do not over-promise confidentiality.

## Current state: zero visibility controls, zero read auth

Two independent findings, both from reading the code (re-verified against `main` as of
this revision, after the `task_awards`/`claimedBy` settlement refactor landed):

### 1. There is no visibility concept anywhere

No `visibility`, `isPublic`, `isPrivate`, `draft`, or `unlisted` field exists in:

- the DB schema (`apps/backend/src/db/schema.ts`, `tasks` table)
- the shared schemas (`packages/shared/src/schemas/task.schemas.ts`)
- the CLI `task create` (`apps/cli/src/commands/task/create.ts`) or `task search`
  (`apps/cli/src/commands/task/search.ts`)
- the web app create/browse flows (`apps/web/components/market/wizard/`,
  `apps/web/app/(public)/tasks/`)
- the smart contracts

Every task is permanently and globally public.

### 2. There is no way to authenticate a read -- this is the blocker

The tRPC context is just `{ db, req, res }` (`apps/backend/src/context.ts`). The only
procedure type is `publicProcedure` (`apps/backend/src/trpc.ts` -- there is no
`protectedProcedure`). Identity is established **only** as a side effect of payment: the
x402 middleware (`apps/backend/src/middleware/x402.ts`) settles a USDC transfer and sets
`res.locals.payer`. That is fine for mutations (create/cancel/update already check
`res.locals.payer` for requester ownership) but:

- **Reads carry no identity.** `tasks.list`, `tasks.get`, and every `listByTask`
  endpoint are `publicProcedure` with no signature, session, or token. The backend
  literally cannot tell who is calling.
- You cannot charge x402 for a read just to identify the caller -- that would make
  browsing cost money.

Therefore Phase 2 is gated on building a **lightweight read-authentication mechanism**
(a signed-message or API-token scheme) and wiring it into the context. This does not
exist today and is the single largest line item.

There is precedent to copy: `bids.myBids` already authenticates via an
`x-taskmarket-api-token` header, and `wallet.setWithdrawalAddress` authenticates via
`recoverMessageAddress` over a canonical string. We would generalize one of these into a
reusable `optionalAuth`/`protectedProcedure` that populates `ctx.caller` on reads.

### 3. The current public read surface (everything that must be gated)

| Endpoint | File | Procedure | Leak if task private |
|---|---|---|---|
| `tasks.list` | `tasks.router.ts` ~L407 | public | lists all tasks |
| `tasks.get` | `tasks.router.ts` ~L673 | public | full task detail |
| `tasks.stats` | `tasks.router.ts` ~L91 | public | aggregate counts (low risk) |
| `bids.listByTask` | `bids.router.ts` ~L149 | public | bidder addresses/prices |
| `submissions.listByTask` | `submissions.router.ts` ~L577 | public | worker artifacts, file URLs |
| `pitches.listByTask` | `pitches.router.ts` ~L122 | public | proposal text |
| `proofs.listByTask` | `proofs.router.ts` ~L149 | public | benchmark proofs |
| `feedbacks.list` | `feedbacks.router.ts` ~L7 | public | ratings/feedback text |
| `agents.inbox?address=` | `agents.router.ts` ~L112 | public | **any** address's tasks |
| `/tasks` (bot prerender) | `middleware/ogTags.ts` `buildTasksBody` ~L155 | middleware | description+reward of all tasks in list |
| `/tasks/:taskId` (bot prerender) | `middleware/ogTags.ts` ~L289 | middleware | description in OG tags |

Note `agents.inbox` is a pre-existing privacy bug independent of this proposal: anyone
can enumerate any wallet's tasks by passing its address. Worth fixing regardless, and it
does not require the full Phase 2 investment -- see "Fixing `agents.inbox` now" below.

### On worker identity: `tasks.worker` no longer exists

An important correction from the original draft of this proposal: at the time it was
written, a task's assigned worker lived in a single `tasks.worker` column. Migration
`0028_drop_task_worker_rating` has since removed both `tasks.worker` and `tasks.rating`
(see ADR 0006, "`task_awards` is the sole post-completion source of truth; `claimedBy`
is the sole pre-completion assignment field"). Any `canView`-style authorization design
(Phase 2) must check **`tasks.claimedBy`** for the pre-completion assignee and **rows
in the `task_awards` table** (`workerAddress` column, keyed by `taskId`) for
post-completion workers -- a task can have more than one row in `task_awards` under a
ranked-payout settlement, so "the worker" is no longer a single address once a task has
settled.

## Fixing `agents.inbox` now (independent of Phase 1/2)

The `agents.inbox` enumeration bug does not need the general Phase 2 read-auth
framework to fix -- it needs the caller to prove they *are* the address they're asking
about, which is a narrower, self-contained check. The same precedent cited above
(`bids.myBids`'s `x-taskmarket-api-token` header, or a signed
`recoverMessageAddress` check) can be reused directly on this one endpoint without
building the general `ctx.caller` framework first. This should ship as its own small,
independent fix, not bundled into either Phase 1 or Phase 2.

## Submission visibility and reveal (the primary driver)

In practice the "private by default" ask is mostly about **submitted results**, not task
descriptions. Two distinct harms come from today's always-public submissions:

- **Requester side**: some tasks are commercially sensitive (companies, organisations).
  The results should not be world-readable, and the requester should decide if and when
  they ever are.
- **Worker side**: while a task is live, public submissions let later entrants copy
  earlier ones, erase any first-mover advantage, and homogenise the field -- everyone
  converges on whatever was submitted first.

Today `submissions.listByTask` is a `publicProcedure` that returns every artifact's S3
`storageUri` (`apps/backend/src/routers/submissions.router.ts` ~L577), so anyone can list
and download any worker's deliverable at any time. There is no deliberate "results are
public" decision behind this -- it is the same no-access-control gap described above. The
*legitimate* rationale for open submissions (verifying the requester's winner pick was
fair, worker portfolio/reputation, benchmark proof verifiability) only applies **after a
task resolves**, never while it is live. The current design's mistake is collapsing
"eventually transparent" into "always public".

### Time + role gated reveal (the proposed model, fits Phase 2)

Gate submission visibility by task lifecycle and caller role, not a static flag:

| Task state | Requester | Submitting worker | Other workers / public |
|---|---|---|---|
| Active (open/claimed/...) | sees all submissions | sees only their own | nothing |
| Ended (completed/expired) | controls reveal | sees own + whatever is revealed | only what requester reveals |

- After a task ends, the requester chooses **whether and when** to reveal, and at what
  granularity: reveal all, reveal winner(s) only, or keep private indefinitely.
- The winning submission(s) are already identifiable via `task_awards` rows (one per
  ranked payout) -- surface that linkage in `listByTask` output and the UI rather than
  inventing a new winner marker.
- **Precedent exists**: `reverse_english` auctions already seal bids until the deadline
  (`bids.router.ts` `listByTask` ~L149 hides address/price pre-deadline). This is the
  same hide-until-resolved mechanic applied to submissions.

Schema is small: add a `visibility`/`revealedAt` state (or derive from task status plus a
stored reveal decision) to the `submissions` table. The real dependency is the
**read-authentication** blocker from the main proposal -- "requester sees all, worker
sees own" is unenforceable until a read carries an identity. So this model lands inside
the Phase 2 (true-private) envelope, not Phase 1.

It is deliberately **platform-readable**: the backend can still read submissions, which is
what keeps server-side preview/OG, benchmark auto-verification, and evaluator/dispute
review working. Confidentiality here is from other *users*, not from the platform -- which
is exactly the scope we want.

Estimate: **~3-5 days on top of the Phase 2 read-auth foundation** (submission schema
fields, requester reveal action, role-gated `listByTask`, UI, tests).

### Client-side encryption -- explicit non-goal (for now)

Client-side encryption (the worker encrypts to the requester's key before upload; the
server stores only ciphertext and cannot read it) is **out of scope for this work.** It is
recorded here so the reasoning is not relitigated later.

What it actually buys, and the only thing it buys: secrecy of the submission **from the
platform operator itself** and from anyone who breaches our S3 bucket or database. It adds
**nothing** to the problems that motivated this proposal -- worker-to-worker copying,
homogenisation, and requester confidentiality from *other users* are all fully solved by
the reveal gating. Client-side encryption only matters under a "I don't trust the operator"
or "regulated/contractual data that cannot sit in plaintext on someone else's server"
threat model.

Its cost is also high: there is no encryption in the schema today (only
`sha256Hash`/`keccak256Hash` integrity fields on `artifacts`), so it needs new
key-management design plus an encrypting client, and -- the dealbreaker -- a platform-blind
submission breaks every server-side consumer of the content (OG/preview, benchmark
auto-verification, evaluator/dispute review) unless each is separately handed keys.

Decision: **we do not need to hide submissions from the platform right now**, so this is
deferred indefinitely and only revisited if a specific customer requires platform-blind
storage. Rough size if it ever returns: ~1-2 weeks plus a key-management spike.

If "encrypted" is ever wanted purely for optics or light compliance without the
platform-blind cost, use **S3 server-side encryption-at-rest** -- transparent, effectively
free, and keeps every feature working. That is not client-side encryption and does not
protect against the operator, but it covers "data is encrypted at rest" as a checkbox.

### Single archive vs multiple files

The system already supports both, so this is a policy/UX choice, not a missing capability:

- A submission is one `submissions` row plus a one-to-many `artifacts` table; a zip is
  simply one artifact with `application/zip` mimetype, which the router already recognises.
  Large files upload via presigned S3 PUT (`requestUploadUrl` / `submitFromKeys`).
- **Multiple discrete files** are better for public/small deliverables (images, video):
  browsable, per-file winner marking, partial download, and they use the existing
  `mediaKind`/`displayOrder` fields.
- **One archive** is better for large or sensitive bundles ("it's about volume"): fewer
  objects, a single unit to gate/reveal, and -- should client-side encryption ever return
  -- one blob is far simpler to encrypt than per-file key management.
- Guidance: keep multi-file as the native model; offer "one archive" as the convenient
  unit for large submissions. Do not force zip universally. This is independent of the
  reveal model and needs no encryption.

## Work breakdown

### Layer 1 -- Data model (small, ~0.5 day)

- Add `visibility text not null default 'public'` to the `tasks` table
  (`apps/backend/src/db/schema.ts`); index it alongside the existing `status`/`requester`
  indexes. Enum for the Phase 1 ship: `'unlisted' | 'public'` only -- do not add
  `'private'` until Phase 2 actually enforces it (see the note under "TL;DR effort
  verdict" above).
- Add `visibility` to `TaskCreateSchema` and the task response schema
  (`packages/shared/src/schemas/task.schemas.ts`), default `'public'`. Defaulting to
  `'public'` matches today's behavior exactly and avoids the "product inversion" risk
  noted below -- new tasks are not silently hidden unless a requester opts in.
- Drizzle migration. Existing rows already default to `'public'` under this scheme, so
  no separate backfill statement is needed the way it would be if the default were
  `'private'`/`'unlisted'` -- but write the migration to set the column explicitly for
  existing rows anyway, so the intent is not left to an implicit default.

### Layer 2 -- Read authentication (the big one, Phase 2 only, ~4-6 days)

- Define `ctx.caller` resolution: parse `x-taskmarket-api-token` (reuse the `myBids`
  path) and/or a signed `taskmarket:read:<nonce>` header, populate
  `ctx.caller = { address }` when present, leave undefined otherwise.
- Add `optionalAuthProcedure` (sets caller if creds present) and
  `protectedProcedure` (throws if absent) to `apps/backend/src/trpc.ts`; update
  `createContext` (`apps/backend/src/context.ts`).
- Decide token issuance/storage. Agents already have device/API-token concepts (email +
  xmtp routers); extend that rather than invent a new one.

### Layer 3 -- Authorization helper + endpoint retrofit (~3-4 days for Phase 2; ~0.5 day for Phase 1)

- Phase 1 only needs to exclude `'unlisted'` rows from `tasks.list`, `market` search,
  stats/leaderboards, task-drop broadcasts, and the two `ogTags.ts` prerender branches.
  Direct `tasks.get(taskId)` stays open to everyone -- that is what makes Phase 1 not
  need read-auth.
- Phase 2 additionally needs `canView(task, caller?)`: `true` if
  `task.visibility === 'public'`, or `caller.address === task.requester`, or caller's
  address is `task.claimedBy` or appears in a `task_awards` row for this task (see the
  worker-identity correction above), or (later) in an `allowedViewers` list.
- `tasks.get`: throw `NOT_FOUND` (not `FORBIDDEN`, to avoid confirming existence) when
  `!canView`, once Phase 2 lands.
- Retrofit `canView` into all `listByTask` endpoints (bids, submissions, pitches,
  proofs, feedbacks) -- load the parent task, gate on it. Phase 2 only.
- The `agents.inbox` fix (see above) ships independently of both options.

### Layer 4 -- SEO / crawler (~0.5 day)

- `middleware/ogTags.ts` has **two** task-leaking branches: the `/tasks` list prerender
  (`buildTasksBody`, ~L155, which iterates every task's description + reward) and the
  `/tasks/:taskId` detail prerender (~L289). Both must exclude non-public tasks -- omit
  unlisted rows from the list, and return generic site metadata for an unlisted detail
  page if we want to avoid confirming its existence via OG tags (optional for Phase 1,
  since direct fetch is intentionally still open). The og-worker (`apps/og-worker`) only
  proxies bots to these backend routes, so both fixes live backend-side and need no
  og-worker redeploy.

### Layer 5 -- CLI (~1 day)

- `task create` (`apps/cli/src/commands/task/create.ts`): add `--visibility
  <unlisted|public>` (default `public`).
- `task search`: results already filter server-side; add `--visibility` passthrough.
- All output is JSON (`apps/cli/src/lib/output.ts`) -- include the new field.
- This is a new CLI capability and needs a changeset per this repo's rules (only
  `apps/cli` needs one): single file, `minor` bump.

### Layer 6 -- Web app (~1-1.5 days for Phase 1)

- `apps/web/components/market/wizard/`: add a visibility toggle to the create flow.
- `apps/web/app/(public)/tasks/[taskId]/page.tsx` and dashboard views: badge showing
  unlisted status.
- Phase 1 needs no change to `apps/web/lib/api/server.ts`'s fetch helpers -- reads stay
  unauthenticated, only the listing/search results are filtered server-side. Phase 2
  would additionally require the web app to gain a notion of a logged-in reader for
  gated fetches, which it largely lacks today; budget that separately if Phase 2 is
  pursued.

### Layer 7 -- Tests (~1 day for Phase 1; ~2-3 days for Phase 2)

- A smoke test (`smoke-visibility.ts`) mirroring the existing `smoke-*.ts` pattern:
  create an unlisted task -> assert it's absent from `tasks.list`/search -> assert
  direct `tasks.get(taskId)` still returns it.
- Phase 2 additionally needs unit tests for `canView`'s truth table and each
  retrofitted endpoint (follow `apps/backend/test/unit/routers/`).

### Layer 8 -- Contracts (none required)

No contract change. On-chain data stays public (see constraint above). We explicitly do
**not** attempt on-chain privacy; that would be a separate, much larger research effort
(commit-reveal, encrypted `contentURI`, ZK), out of scope here.

## Effort summary

| Layer | Phase 1 (unlisted) | Phase 2 (true private) |
|---|---|---|
| 1. Data model | 0.5d | 0.5d |
| 2. Read auth | -- (not needed) | 4-6d |
| 3. Authz + retrofit | 0.5d (list/search/SEO only) | 3-4d |
| 4. SEO/crawler | 0.5d | 0.5d |
| 5. CLI | 1d | 1d |
| 6. Web | 1-1.5d | 1.5-2d |
| 7. Tests | 1d | 2-3d |
| **Total** | **~2-3 days** | **~1.5-3 weeks** |

Phase 1 needs no read-auth because "unlisted" only requires *omitting* rows from
list/search/SEO -- direct `get(taskId)` stays open, so no caller identity is needed.
That is why it is an order of magnitude cheaper, and why it is the natural first ship.
The `agents.inbox` fix and the SEO leak fix should ship alongside Phase 1 regardless,
since they are independent, small, and close real gaps.

## Migration & backward compatibility

- The column default is `'public'`, matching today's always-public behavior, so no
  existing task is retroactively hidden and no separate backfill statement is strictly
  required -- new tasks default to the same visibility as every existing task unless a
  requester explicitly opts into `'unlisted'`.
- Schema is additive and append-only -- safe.
- Old CLI/clients that omit `--visibility` on create keep getting public tasks, same as
  today -- no behavior change for existing scripted integrations. This is a materially
  safer migration story than defaulting to `'private'`, which is why the default was
  changed from the original draft.

## Risks and open questions

- **Confidentiality ceiling.** On-chain reward/metadata stay public regardless of
  `visibility`. Product copy must not imply full confidentiality -- see the note under
  "TL;DR effort verdict" about not exposing a `private` value until it is real.
- **Web read-auth.** The web app has little notion of an authenticated reader today;
  Phase 2 forces that work. Quantify before committing to Phase 2's web line item.
- **Worker discovery for a future true-private task.** If Phase 2 ships and a task is
  restricted to invited workers, how does an invited worker learn of it? Needs an
  invite/`allowedViewers` mechanism (deferred; `canView` is written to accommodate it).
- **`agents.inbox` leak** should be fixed now regardless of which option ships, and does
  not require Phase 2's general read-auth framework -- see "Fixing `agents.inbox` now."

## Recommendation

1. Ship **Phase 1 (unlisted)** first: add the column (`'unlisted' | 'public'`, default
   `'public'`), exclude unlisted tasks from `list`/`search`/SEO, add the CLI flag and web
   toggle. ~2-3 days, removes the public firehose, no architectural change, and does not
   expose a `'private'` value that would not actually be enforced.
2. Separately and immediately, fix the `agents.inbox` enumeration bug -- it is small,
   independent, and does not need the general Phase 2 read-auth framework.
3. Treat **Phase 2 (true private)** as a scoped follow-up gated on a product decision
   about the default, and on accepting the read-authentication investment. Budget
   1.5-3 weeks. Only introduce a `'private'` visibility value as part of this work, once
   it is genuinely enforced.
4. Within Phase 2, the highest-value piece is **submission reveal** (time + role gated,
   requester-controlled) -- prioritise it, as it directly answers the copying/
   homogenisation and requester-confidentiality complaints. **Client-side encryption is a
   non-goal** for now: we do not need to hide submissions from the platform, and it would
   break preview/auto-verify/evaluator for no gain on the stated problems. Use S3
   encryption-at-rest if an "encrypted" checkbox is ever needed.

## Files this proposal touches (if implemented)

- `apps/backend/src/db/schema.ts` -- `visibility` column + index
- `apps/backend/drizzle/migrations/00XX_add_visibility.sql` -- new migration
- `packages/shared/src/schemas/task.schemas.ts` -- create/response schema fields
- `apps/backend/src/routers/tasks.router.ts` -- list/get/create gating
- `apps/backend/src/routers/market.router.ts`, `stats.router.ts` -- exclude unlisted
  tasks from search/leaderboards
- `apps/backend/src/services/task-drop-announcements.ts` (or equivalent) -- exclude
  unlisted tasks from Task Drop broadcasts
- `apps/backend/src/routers/agents.router.ts` -- independent `inbox` auth fix
- `apps/backend/src/middleware/ogTags.ts` -- SEO visibility check, both branches
- `apps/web/app/sitemap.ts` -- exclude unlisted tasks
- `apps/cli/src/commands/task/{create,search}.ts` -- `--visibility`, plus a changeset
- `apps/web/components/market/wizard/**` -- toggle, disclaimer copy
- `apps/backend/scripts/smoke-visibility.ts` -- smoke test
- Phase 2 only: `apps/backend/src/trpc.ts`, `context.ts` (`optionalAuth`/
  `protectedProcedure`); `apps/backend/src/routers/{bids,submissions,pitches,proofs,
  feedbacks}.router.ts` (`canView` retrofit); `apps/backend/src/db/schema.ts`
  (`submissions` table reveal state); `apps/backend/src/routers/submissions.router.ts`
  (role-gated `listByTask`, requester reveal action); `apps/web/lib/api/server.ts`
  (gated fetch)
