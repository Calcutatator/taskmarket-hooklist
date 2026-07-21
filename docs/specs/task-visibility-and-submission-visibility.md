# Task Visibility and Submission Visibility

Status: Phase 1 decided and shipped -- see ADR-0014 (task visibility, public-by-default
  opt-in), ADR-0015 (Phase 1's scoped inbox self-auth), ADR-0016 (submission visibility as
  an independent axis), ADR-0017 (`bids.myBids` signed self-auth), and ADR-0018
  (`devices.register` signature proof), all Accepted. Phase 2 (submission visibility) and
  Phase 3 (true private tasks) below are still open proposals, not decided.
Owner: Taskmarket
Last updated: 2026-07-21

This is an RFC: a design proposal for discussion, not a decision record. Once a direction is
chosen, the decision itself belongs in an ADR under `docs/adr/` (see `docs/adr/README.md`
for the process) — a human must explicitly approve that ADR before it's considered decided.
This document should not be read as already-approved.

## Question this answers

> How much effort is it to let a requester make a task not-publicly-listed, and to keep
> its submissions from being world-readable while it's live?

**Tasks stay public by default -- that is the product decision, not up for revisiting
in this document.** Every existing task, and every new task unless a requester
explicitly opts in otherwise, is discoverable exactly as it is today.

This document scopes **three independent axes**, not one option that gets progressively
more expensive:

- **Task visibility** -- can other people find/view this task at all: `public` (default)
  or `unlisted` now; `private` (invite-only -- password-protected or scoped to an
  explicit wallet allowlist), later.
- **Submission visibility** -- once someone can view the task, can they also see what
  workers submitted to it: a **four-value enum, chosen at task creation and locked in
  permanently** (changing it later is explicitly out of scope for now -- future
  follow-up work if ever needed) -- **independent of the task's own visibility.** A
  fully public, fully listed task can still choose to keep its submissions hidden until
  it resolves; an unlisted task could, in principle, choose fully public submissions.
  These are two different questions and this RFC treats them as such, matching the
  product decision to keep them orthogonal rather than bundling "hidden submissions"
  under "private task."
- **True private tasks** -- the task itself is not viewable by anyone but the requester
  and invited/assigned workers. This is the expensive, deferred option.

Short answer: **the data-model and UI work for the opt-in `unlisted` task-visibility
value is small (~5.5-6.5 days, including one narrow self-authentication check -- see
below, already shipped); submission visibility is a moderate follow-up (~7-11 days) that
pays for a foundational piece the codebase does not have today -- general read-time
authentication -- which then makes true-private tasks meaningfully cheaper as a further
follow-up (~1-1.5 weeks on top) rather than a second multi-week outlay.** Every task and
submission read endpoint is currently an unauthenticated `publicProcedure`. To let
"requester sees all, submitting worker sees only their own" or "task visible only to
invited workers" actually hold, you must be able to answer "who is asking?" on the
relevant GET requests, and right now the backend can only answer that narrowly, for one
endpoint, not generally.

This document scopes the work, names the blocker, and offers three delivery phases:
**Phase 1 (unlisted tasks, shipped)**, **Phase 2 (submission visibility, opt-in --
default `public`, matching today exactly)**, and **Phase 3 (true private tasks)**.
Client-side (platform-blind) encryption is an explicit non-goal for now, for any phase.

## TL;DR effort verdict

| Phase | What you get | Estimate |
|---|---|---|
| **Phase 1 -- Unlisted tasks (shipped)** | Tasks hidden from public list/search/SEO, but anyone with the task ID/URL can still view. One narrow self-auth check (see `agents.inbox` below); no general read-auth. | **~5.5-6.5 days** |
| **Phase 2 -- Submission visibility** | A `submissionVisibility` choice at task creation (`public` default, or opt-in `reveal_all` / `winner_only` / `never`), locked in permanently, independent of the task's own visibility. Builds the general read-authentication foundation this and Phase 3 both need. | **~7-11 days** |
| **Phase 3 -- True private tasks** | Tasks visible only to requester + invited/assigned workers (password-protected or wallet-scoped). Reuses Phase 2's read-auth foundation, so it is now an incremental follow-up rather than its own multi-week foundation-plus-feature cost. | **~1-1.5 weeks on top of Phase 2** |

The honest recommendation: **Phase 1 is done.** Ship **Phase 2 next** -- it closes the
loudest real complaint (world-readable submissions while a task is live, for anyone who
opts into a hiding mode) and, unlike Phase 1, has to build the read-auth foundation
anyway, which is the expensive part of Phase 3 too. Treat **Phase 3** as a scoped
follow-up gated on a separate product decision about whether true-private tasks are
worth building at all. All three phases are strictly opt-in; the default stays
`public`/`public`/`public` in every case, so no phase changes what today's users already
experience unless they explicitly choose otherwise.

**On the word "private":** Phase 1 does not build any real access control, so the
shipped implementation exposes only two task-visibility values -- `unlisted` and
`public` -- not a `private` value. Presenting a `private` task-visibility option that
behaves identically to `unlisted` (no actual enforcement) would mislead a requester into
believing something is access-restricted when it is not. A `private` **task-visibility**
value should only be added once Phase 3's read-authentication work actually enforces
it. This does not apply to submission visibility, which is a different field: Phase
2's `submissionVisibility` is real, enforced access control for any non-`public` value
from the moment it ships (gated on the read-auth foundation Phase 2 itself builds), so
exposing `reveal_all`/`winner_only`/`never` there is honest from day one.

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

So opting a task into `unlisted` (and, later, `private`) precisely means: **the
off-chain content and the convenience discovery surface (list, search, SEO previews,
inbox lookups of a third party's tasks) are gated for that one task; the on-chain
existence, reward, and metadata remain publicly observable regardless.** This is an
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

Therefore Phase 2 (submission visibility) is what actually builds a **lightweight
read-authentication mechanism** (a signed-message or API-token scheme) and wires it into
the context, as part of its own scope -- not a separate prerequisite phase. This does
not exist today and is the single largest line item in Phase 2's cost, and Phase 3
reuses it rather than building its own.

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
| `agents.inbox?address=` | `agents.router.ts` ~L112 | public | any address's `unlisted`/private tasks, once those exist |
| `/tasks` (bot prerender) | `middleware/ogTags.ts` `buildTasksBody` ~L155 | middleware | description+reward of all tasks in list |
| `/tasks/:taskId` (bot prerender) | `middleware/ogTags.ts` ~L289 | middleware | description in OG tags |

**`agents.inbox` is not a bug on its own** for third-party lookups -- see the note right
after the worker-identity correction below for why -- but it does need one narrow,
scoped self-authentication check as part of Phase 1, so an address's own owner can see
their own `unlisted` tasks. See "What `agents.inbox` actually needs" below; this is
smaller than it sounds and does not require Phase 2's general read-auth framework.

### On worker identity: `tasks.worker` no longer exists

An important correction from the original draft of this proposal: at the time it was
written, a task's assigned worker lived in a single `tasks.worker` column. Migration
`0028_drop_task_worker_rating` has since removed both `tasks.worker` and `tasks.rating`
(see ADR 0006, "`task_awards` is the sole post-completion source of truth; `claimedBy`
is the sole pre-completion assignment field"). Any `canView`-style authorization design
(Phase 3) must check **`tasks.claimedBy`** for the pre-completion assignee and **rows
in the `task_awards` table** (`workerAddress` column, keyed by `taskId`) for
post-completion workers -- a task can have more than one row in `task_awards` under a
ranked-payout settlement, so "the worker" is no longer a single address once a task has
settled.

## What `agents.inbox` actually needs

An earlier draft of this proposal called `agents.inbox` a "pre-existing privacy bug"
and proposed requiring the caller to prove they *are* the address they're asking about
before returning anything -- i.e., turning it into an authenticated "my inbox only"
endpoint. That was wrong, and worth recording so it isn't re-proposed.

`agents.stats` (`apps/backend/src/routers/agents.router.ts`) and `agents.leaderboard`
sit right next to `inbox` in the same router, are equally `publicProcedure`, and return
a wallet's aggregate reputation (completed tasks, ratings, earnings, rank) for *any*
address, no auth, by design. Looking up any wallet's public history and reputation is
already a deliberate, consistent feature of this marketplace -- the same idea as
checking an address's history on a block explorer before dealing with it. `agents.inbox`
is just the detailed version of that same already-intentional pattern, not an anomaly.
Requiring self-authentication would break that existing, intentional feature for anyone
relying on it (a requester checking a worker's track record before selecting them, a
tool building agent reputation lookups), which is a real product decision, not a bug fix
-- out of scope for this proposal.

By default, once `unlisted` visibility exists, `agents.inbox` should exclude `unlisted`
tasks from its results -- the same as every other public listing endpoint. But
`agents.inbox` has no way to know who is calling today, only which address was asked
about, so without something more it cannot distinguish "the owner asking about
themselves" from anyone else asking about them -- which would leave an address's own
owner unable to find their own unlisted tasks anywhere except a saved direct link. That
is a real gap for the web dashboard's "my tasks" view specifically (a CLI/agent already
has the task ID the moment it creates, claims, bids, pitches on, or submits to a task,
so it does not depend on `inbox` to rediscover its own tasks -- but the web dashboard
does).

The fix is a **narrow, scoped self-authentication check on this one endpoint**, reusing
the precedent already established elsewhere rather than building anything new:
`wallet.setWithdrawalAddress`'s signed-message pattern (`recoverMessageAddress` over a
canonical string) is the better fit here, and it is the *only* fit -- not just a matter
of taste. An earlier draft of this section framed the choice as "signed message vs. the
device/API-token header `bids.myBids` used," as if either could plausibly prove wallet
ownership and signed-message just happened to avoid an onboarding step. Checking
`devices.register` (`apps/backend/src/routers/devices.router.ts`) directly disproves that
framing: it mints a `deviceId`/`apiToken` pair from a client-supplied `walletAddress`
string with **no signature check at all** -- anyone can register a device claiming any
address. The token is real (it gates a genuinely useful, separate thing: server-assisted
decryption of the CLI's locally-encrypted key, plus XMTP/email identity), but it was
never proof that the caller controls the address it is scoped to, so it could never
have satisfied `agents.inbox`'s actual requirement. (`bids.myBids` was consequently
converted to this same signed-message pattern in the same PR, for the same reason --
see ADR-0017.) Concretely: `agents.inbox` accepts an optional signature over a
canonical `taskmarket:inbox:<address>` message (built via the shared
`buildInboxSelfAuthMessage` helper in `@taskmarket/shared`, no nonce -- this is a read
with no state-changing side effect, so a replayed signature does nothing a fresh one
couldn't); if present and it recovers to the `address` being queried, include that
address's own `unlisted` tasks in the response; if absent or invalid, behave exactly as
today (public tasks only, for any address, no error). The recovery-and-compare logic
itself is a single shared `verifySignedAddress` helper (`apps/backend/src/lib/agents.ts`)
reused by every backend endpoint that verifies a caller-owned-address claim this way --
this is a small, self-contained verification function, not the general `ctx.caller`
context-level framework Phase 2 (submission visibility) needs wired into every relevant
read endpoint, and not a reason to pull any of Phase 2 or Phase 3's other scope
(submission visibility, `canView` retrofit across `listByTask` endpoints, a real
`private` task-visibility value) forward. It ships as part of Phase 1's Layer 3
retrofit, not a separate PR, and nudges Phase 1's estimate up modestly (see the updated
effort table below) rather than merging the phases.

## Phase 2: Submission visibility

In practice the demand for task-level privacy is mostly about **submitted results**, not
task descriptions -- this is a genuinely different axis from task visibility (above),
not a more-expensive version of it. Two distinct harms come from today's always-public
submissions:

- **Requester side**: some tasks are commercially sensitive (companies, organisations).
  The results should not be world-readable, and the requester should decide if and when
  they ever are.
- **Worker side**: while a task is live, public submissions let later entrants copy
  earlier ones, erase any first-mover advantage, and homogenise the field -- everyone
  converges on whatever was submitted first.

Today `submissions.listByTask` is a `publicProcedure` that returns every artifact's S3
`storageUri` (`apps/backend/src/routers/submissions.router.ts` ~L577), so anyone can list
and download any worker's deliverable at any time, on **every** task regardless of that
task's own visibility -- a `public`/listed task and an `unlisted` one leak submissions
identically today. There is no deliberate "results are public" decision behind this -- it
is the same no-access-control gap described above. The *legitimate* rationale for open
submissions (verifying the requester's winner pick was fair, worker portfolio/reputation,
benchmark proof verifiability) only applies **after a task resolves**, never while it is
live. The current design's mistake is collapsing "eventually transparent" into "always
public".

### One field, chosen at creation, locked in permanently

Submission visibility is a single `submissionVisibility` field on the task, set once
at creation time and **locked in permanently** -- there is no mechanism to change it
after the task is created. (Adding one later, e.g. before any submissions exist, is
plausible future follow-up work, but is explicitly out of scope here; this RFC scopes
the simpler, immutable-after-creation version.) This mirrors the task-level `visibility`
field's shape -- an opt-in enum decided upfront -- and is independent of `visibility`
itself: a fully `public`, fully listed task can choose any submission visibility; an `unlisted`
task can equally choose any submission visibility.

Four values, matching the actual product need (a spectrum from fully open to fully
closed, not a binary):

| Mode | While active | Once the task ends |
|---|---|---|
| `public` (**default**) | visible to anyone who can view the task, immediately -- exactly today's behavior | stays visible |
| `reveal_all` | hidden (see role-gated table below) | **all** submissions become visible automatically |
| `winner_only` | hidden | only the winning submission(s) become visible automatically; the rest stay hidden |
| `never` | hidden | stays hidden indefinitely (requester + submitting worker only) |

Defaulting to `public` matches today's exact behavior and this RFC's established
opt-in-only philosophy (the same reasoning ADR 0014 already settled for task
visibility) -- a requester gets no submission protection unless they explicitly choose
one of the other three modes at creation time.

### Time + role gated reveal (the proposed model -- this is Phase 2)

For any non-`public` mode, gate submission visibility by task lifecycle and caller
role while the task is active, not a static flag:

| Task state | Requester | Submitting worker | Other workers / public |
|---|---|---|---|
| Active (open/claimed/...) | sees all submissions | sees only their own | nothing |
| Ended (completed/expired) | sees all (per the chosen mode) | sees own + whatever the mode reveals | only what the mode reveals (`reveal_all`: everything; `winner_only`: the winner(s); `never`: nothing) |

- The winning submission(s) are already identifiable via `task_awards` rows (one per
  ranked payout) -- surface that linkage in `listByTask` output and the UI rather than
  inventing a new winner marker.
- Because the mode is locked in at creation, "ended" behavior is a deterministic
  transition, not a fresh discretionary action -- there is no separate "reveal now"
  button or requester decision to make at resolution time; the pre-chosen mode simply
  takes effect.
- **Precedent exists**: `reverse_english` auctions already seal bids until the deadline
  (`bids.router.ts` `listByTask` ~L149 hides address/price pre-deadline). That mechanism
  is purely time-gated (hidden from literally everyone pre-deadline, no caller identity
  needed); submission visibility's "requester sees all, worker sees own" while active
  additionally needs to distinguish *which* caller is asking, which is exactly why it
  needs the read-authentication foundation below rather than reusing the bid-sealing
  mechanism as-is.

Schema is small: add `submissionVisibility` (`'public' | 'reveal_all' | 'winner_only' |
'never'`, default `'public'`) to the `tasks` table. Because the default matches today's
exact behavior, this carries the same zero-migration-risk property as `visibility` in
Phase 1 -- no backfill needed, no existing task's behavior changes. The real dependency
is **general read-authentication**: "requester sees all, worker sees own" is
unenforceable until a read carries an identity, and the codebase has no such mechanism
today (see "Current state" above). Phase 2 builds that foundation as part of its own
scope -- Phase 3 (true private tasks) then reuses it rather than paying for it twice.

It is deliberately **platform-readable**: the backend can still read submissions, which is
what keeps server-side preview/OG, benchmark auto-verification, and evaluator/dispute
review working. Confidentiality here is from other *users*, not from the platform -- which
is exactly the scope we want.

**Three public read-paths for artifact content exist today, not just `listByTask` --
Phase 2 must gate all three or the feature doesn't actually do what it says:**

- `submissions.listByTask` (`apps/backend/src/routers/submissions.router.ts` ~L561) --
  already named above. Returns every submission's raw `fileUrl` unconditionally, and
  (when `includePreviewUrls=media`) also generates and returns presigned S3 URLs for
  media artifacts inline. `publicProcedure`, no caller identity.
- `submissions.previewArtifact` (`GET /api/tasks/{taskId}/artifacts/{artifactId}/preview`,
  ~L901) -- a second, independent `publicProcedure` that hands back a presigned S3 URL
  to an artifact's raw content given only its `taskId`/`artifactId`. No caller identity,
  no role check, no task-state check at all. A separate code path from `listByTask`;
  gating `listByTask` alone would not close this one -- a caller who already has (or
  scrapes, since `listByTask` hands out every `artifactId` for every task) an
  `artifactId` could still fetch full content through `previewArtifact` regardless of
  the task's `submissionVisibility` mode.
- `submissions.download` (~L991) -- also `publicProcedure`. Its only gate is
  `task.status === 'completed'`; it takes `acceptanceTxHash` as a required input but
  never actually validates it against anything (dead/decorative parameter, not a real
  check). Critically, it has no knowledge of `submissionVisibility` at all -- once that
  field exists, a task set to `winner_only` or `never` would still have any of its
  submissions fetchable via `download` by anyone who knows the `submissionId`, since
  this endpoint doesn't check the mode. This is a distinct gap from `previewArtifact`
  (pre-completion vs. post-completion) and needs separate handling in Phase 2's
  role/mode-gating work.

`submissions.preview` (~L788) is unrelated to this list -- it's already properly gated
today (requester or submitting worker only, device-token authenticated) for the
pre-acceptance review flow the CLI uses, and doesn't need Phase 2 changes.

A fifth surface has the same gap as `download`: `submissions.listByWorker`
(`GET /agents/{address}/work`, ~L668) -- the public agent-portfolio endpoint. It's scoped
via `task_awards` to completed/awarded work and defaults `includePreviewUrls` to
`'media'`, so it already surfaces presigned media URLs for a worker's finished tasks with
no `submissionVisibility` awareness. Once that field exists, a `winner_only`/`never`
task's awarded work would still show up in the worker's public portfolio unless this
endpoint is also updated to respect the mode.

(Confirmed via a full-backend sweep for every `getPresignedUrl` call site --
`listByTask`, `previewArtifact`, `preview`, `download`, and `listByWorker` in
`submissions.router.ts` are the only five; no other router exposes file content this
way.)

The submission visibility setting needs to be settable from every task-creation surface, not just the
API: the CLI (`task create --submission-visibility <public|reveal_all|winner_only|
never>`, default `public`) and the web app (a control in the create wizard next to the
task-visibility toggle, locked/read-only once the task exists). Both surfaces' docs and
the agent skill bundle (`apps/docs/src/public/skill.md` and `reference/cli.md`) need the
same treatment Phase 1 gave task visibility -- this is new agent-facing behavior, not an
internal-only change: a worker deciding whether to submit needs to know upfront whether
their work will ever become visible to competitors.

Estimate: **~7-11 days total** (4-6d general read-authentication foundation + 3-5d
submission schema field, mode-aware role-gated `listByTask`, `previewArtifact`,
`download`, and `listByWorker`, CLI, web, docs/skill, and tests).

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
  visibility model and needs no encryption.

## Work breakdown

### Layer 1 -- Data model (small, ~0.5 day per phase)

- **Phase 1 (shipped):** `visibility text not null default 'public'` on the `tasks`
  table (`apps/backend/src/db/schema.ts`); indexed alongside the existing
  `status`/`requester` indexes. Enum: `'unlisted' | 'public'` only -- no `'private'`
  until Phase 3 actually enforces it (see the note under "TL;DR effort verdict" above).
  Added to `TaskCreateSchema` and the task response schema
  (`packages/shared/src/schemas/task.schemas.ts`), default `'public'`.
- **Phase 2:** `submissionVisibility text not null default 'public'` on the `tasks`
  table (`'public' | 'reveal_all' | 'winner_only' | 'never'`) -- see "Phase 2:
  Submission visibility" above. Independent field from `visibility`, chosen once at
  creation and immutable thereafter (no update path). Because the default (`'public'`)
  matches existing rows' already-established behavior exactly, this carries the same
  zero-backfill-risk property `visibility` had in Phase 1.
- **Phase 3:** add `'private'` to the `visibility` enum once `canView` genuinely
  enforces it (below), plus an `allowedViewers`-style table for invited workers.

### Layer 2 -- Read authentication (the big one, built once in Phase 2, ~4-6 days)

- Define `ctx.caller` resolution: parse `x-taskmarket-api-token` (reuse the `myBids`
  path) and/or a signed `taskmarket:read:<nonce>` header, populate
  `ctx.caller = { address }` when present, leave undefined otherwise.
- Add `optionalAuthProcedure` (sets caller if creds present) and
  `protectedProcedure` (throws if absent) to `apps/backend/src/trpc.ts`; update
  `createContext` (`apps/backend/src/context.ts`).
- Decide token issuance/storage. Agents already have device/API-token concepts (email +
  xmtp routers); extend that rather than invent a new one.
- This is Phase 2's foundation, not Phase 3's: submission visibility needs "is this caller
  the requester / this specific submitting worker" the moment it ships. Phase 3 reuses
  this framework rather than building its own, which is why Phase 3's own cost is
  smaller than the original single "true private" estimate.

### Layer 3 -- Authorization helper + endpoint retrofit (~1-1.5 days for Phase 1, shipped; ~1-2 days for Phase 2; ~3-4 days for Phase 3)

- **Phase 1 (shipped):** excludes `'unlisted'` rows from `tasks.list`, `market` search,
  stats/leaderboards, task-drop broadcasts, and the two `ogTags.ts` prerender branches --
  a plain filter, no auth. Direct `tasks.get(taskId)` stays open to everyone. Plus the
  narrow signed-message self-authentication check on `agents.inbox` described in "What
  `agents.inbox` actually needs" above -- the one place in Phase 1 that touches
  authentication, a single scoped check, not the general `ctx.caller` framework below.
  The filter itself lives in one shared module, `apps/backend/src/lib/task-visibility.ts`
  (exports `taskNotUnlisted`, a drizzle `SQL` condition), imported by every query site
  above rather than each one inlining its own `ne(tasks.taskVisibility, 'unlisted')` --
  this is what keeps "what counts as excluded" defined once instead of drifting per
  call site. See `apps/backend/test/unit/middleware/ogTags.test.ts` for unit coverage
  that asserts the real shared condition (not just mock data) is present in a query's
  rendered SQL.
- **Phase 2:** a submission-specific role check -- `isRequester(caller, task)` /
  `isSubmittingWorker(caller, submission)` -- applied inside `submissions.listByTask`
  whenever `task.submissionVisibility !== 'public'`, plus a deterministic post-resolution
  branch per mode (`reveal_all`: show everything once ended; `winner_only`: show only
  `task_awards`-linked rows once ended; `never`: keep the role-gated view forever).
  Narrower than Phase 3's general `canView`: it only needs to answer "can this caller
  see *this* submission," not "can this caller see the task at all." Follow the same
  shared-module shape Phase 1 established: put these predicates in one place (e.g.
  `apps/backend/src/lib/submission-visibility.ts`) rather than inlining the role/mode
  branching inside `submissions.listByTask` itself, so any second call site Phase 2 or
  Phase 3 adds imports the same predicate instead of re-deriving it. Task visibility and
  submission visibility are independent axes with different shapes (a single boolean-ish
  exclusion vs. a four-value, time-and-role-gated enum) -- there is no single predicate
  that covers both, so the right reuse here is the *pattern* (one shared, tested module
  per axis), not a shared function.
- **Phase 3:** the general `canView(task, caller?)`: `true` if
  `task.taskVisibility === 'public'`, or `caller.address === task.requester`, or caller's
  address is `task.claimedBy` or appears in a `task_awards` row for this task (see the
  worker-identity correction above), or in an `allowedViewers` list. `tasks.get` throws
  `NOT_FOUND` (not `FORBIDDEN`, to avoid confirming existence) when `!canView`.
  Retrofit `canView` into the *other* `listByTask` endpoints (bids, pitches, proofs,
  feedbacks) -- `submissions.listByTask` was already retrofitted in Phase 2.

### Layer 4 -- SEO / crawler (~0.5 day, Phase 1, shipped)

- `middleware/ogTags.ts` has **two** task-leaking branches: the `/tasks` list prerender
  (`buildTasksBody`, ~L155, which iterates every task's description + reward) and the
  `/tasks/:taskId` detail prerender (~L289). Both exclude non-public tasks -- unlisted
  rows omitted from the list; the detail page stays open for now, since direct fetch is
  intentionally still reachable for an unlisted task. Phase 3 would need the detail
  branch to return generic site metadata for a genuinely private task, to avoid
  confirming its existence via OG tags.

### Layer 5 -- CLI (~1 day for Phase 1, shipped; ~1-1.5 days for Phase 2)

- **Phase 1 (shipped):** `task create --task-visibility <unlisted|public>` (default
  `public`); `taskmarket inbox` signs its self-auth message automatically. `task
  search`/`list` deliberately left unchanged -- `tasks.list` has no per-call override to
  reveal unlisted tasks, so a flag there would filter nothing.
- **Phase 2:** `task create --submission-visibility <public|reveal_all|winner_only|
  never>` (default `public`), set once at creation with no update command -- there is
  nothing to change later since the mode is locked in permanently. All output stays
  JSON per `apps/cli/src/lib/output.ts`.
- Each phase's CLI change needs its own changeset per this repo's rules (only
  `apps/cli` needs one): single file, `minor` bump.

### Layer 6 -- Web app (~1.5-2 days for Phase 1, shipped; ~1.5-2 days for Phase 2)

- **Phase 1 (shipped):** visibility toggle in the create wizard; "Unlisted" badge on
  the task detail page and the dashboard "You" feed; the dashboard's inbox query signs
  the `agents.inbox` self-auth message once per connected wallet per session (see "What
  `agents.inbox` actually needs") so the owner's own unlisted tasks show up there too.
  Every other read (`list`, `search`, a third party's `inbox`) stays exactly as
  unauthenticated as it is today.
- **Phase 2:** a `submissionVisibility` control (four options) in the create wizard next
  to the task-visibility toggle, sharing the same disclaimer-copy pattern, shown as
  read-only/locked once the task exists (no edit UI, since there is no update path); the
  submissions list view respects whatever the backend now returns (already gated
  server-side, so this is mostly "don't assume every submission in the response is
  visible to render a comparison UI the same way for everyone").
- **Phase 3** would additionally require the web app to gain a notion of a logged-in
  reader for *every* gated fetch, which it still lacks after Phase 2 (Phase 2's web
  changes are scoped to the two call sites above, not a general authenticated-fetch
  layer); budget that separately if Phase 3 is pursued.

### Layer 7 -- Docs & agent skill (~0.5 day for Phase 1, shipped; ~0.5-1 day for Phase 2)

- **Phase 1 (shipped):** `reference/cli.md`, `reference/raw-api.md`,
  `reference/task-schema.md`, and `skill.md` all cover `visibility`/`unlisted`,
  including explicit agent guidance that unlisted is not confidentiality. Mirrored to
  `pages/`.
- **Phase 2:** the same four files need the equivalent treatment for
  `submissionVisibility` -- this is new agent-facing behavior (a new CLI flag, a new
  response field, and critically, agent guidance that the mode is locked in permanently
  once chosen) -- so it needs the same doc/skill coverage Phase 1 got, not an
  afterthought.

### Layer 8 -- Tests (~1 day for Phase 1, shipped; ~2-3 days for Phase 2; ~2-3 days for Phase 3)

- **Phase 1 (shipped):** `smoke-visibility.ts` mirroring the existing `smoke-*.ts`
  pattern: create an unlisted task, confirm it's absent from `tasks.list`/search,
  confirm direct `tasks.get(taskId)` still returns it, confirm the owner's own
  `agents.inbox` (self-auth signed) includes it while an unauthenticated call doesn't.
- **Phase 2:** unit tests for the submission role-check's truth table (requester /
  submitting worker / other worker, active / ended, revealed / not) plus a
  `smoke-submission-visibility.ts`-style end-to-end test.
- **Phase 3:** unit tests for `canView`'s truth table and each retrofitted endpoint
  (follow `apps/backend/test/unit/routers/`).

### Layer 9 -- Contracts (none required, any phase)

No contract change. On-chain data stays public (see constraint above). We explicitly do
**not** attempt on-chain privacy; that would be a separate, much larger research effort
(commit-reveal, encrypted `contentURI`, ZK), out of scope here.

## Effort summary

| Layer | Phase 1 (unlisted, shipped) | Phase 2 (submission visibility) | Phase 3 (true private) |
|---|---|---|---|
| 1. Data model | 0.5d | 0.5d | 0.5d |
| 2. General read-auth framework | -- (not needed) | 4-6d (built here) | -- (reuses Phase 2's) |
| 3. Authz + retrofit | 1-1.5d (scoped `agents.inbox` self-auth) | 1-2d (submission role check) | 3-4d (`canView` + remaining `listByTask` retrofit) |
| 4. SEO/crawler | 0.5d | -- | 0.5d (private detail-page treatment) |
| 5. CLI | 1d | 1-1.5d | 1d |
| 6. Web | 1.5-2d | 1.5-2d | 1.5-2d (general authenticated-fetch layer) |
| 7. Docs & skill | 0.5d | 0.5-1d | 0.5-1d |
| 8. Tests | 1d | 2-3d | 2-3d |
| **Total** | **~5.5-6.5 days (shipped)** | **~7-11 days** | **~8.5-11.5 days on top of Phase 2** |

Phase 1 does not need the *general* read-auth framework (Layer 2) -- `unlisted` mostly
requires *omitting* rows from list/search/SEO, and direct `get(taskId)` stays open, so
no caller identity is needed for those. The one exception is `agents.inbox`, which needs
a narrow, scoped self-authentication check so an address's own owner can find their own
unlisted tasks (see "What `agents.inbox` actually needs" above) -- a single verification
function reused from existing precedent, not new infrastructure.

Phase 2 is where the general read-auth framework actually gets built, because
"requester sees all, submitting worker sees only their own" is unenforceable without it.
That is a real, unavoidable cost of closing the submission-visibility gap -- but paying
it once in Phase 2 is why Phase 3 (true private tasks) is no longer its own multi-week
foundation-plus-feature project: Phase 3's cost above is *only* the incremental
`canView`/retrofit/invite work, on top of infrastructure Phase 2 already paid for.
Sequencing it this way is strictly cheaper in total than building Phase 3 standalone.

## Migration & backward compatibility

- The `visibility` column defaults to `'public'`, and the `submissionVisibility` column
  defaults to `'public'` too -- both match every existing task's already-established
  behavior exactly, so neither needs a separate backfill statement. This is a direct
  consequence of keeping both fields opt-in-only (ADR 0014's reasoning, extended to
  submission visibility): a plain `DEFAULT 'public'` on the `ALTER TABLE ADD COLUMN` is
  safe precisely because `'public'` is what every row already behaves like.
- Schema is additive and append-only -- safe.
- Old CLI/clients that omit `--task-visibility`/`--submission-visibility` on create keep
  getting today's fully-open behavior for whichever field they omit -- no behavior
  change for existing scripted integrations.
- `submissionVisibility` has no update path once set -- there is no migration concern
  about a value changing after the fact, since it structurally cannot.

## Risks and open questions

- **Confidentiality ceiling.** On-chain reward/metadata stay public regardless of
  `visibility`. Product copy must not imply full confidentiality -- see the note under
  "TL;DR effort verdict" about not exposing a `private` **task-visibility** value until
  Phase 3 makes it real.
- **Web read-auth.** The web app has little notion of an authenticated reader today;
  Phase 2 builds a narrow slice of this (the two call sites in Layer 6), not a general
  authenticated-fetch layer -- Phase 3 still needs to quantify and build that
  separately.
- **Worker discovery for a future true-private task.** If Phase 3 ships and a task is
  restricted to invited workers, how does an invited worker learn of it? Needs an
  invite/`allowedViewers` mechanism (deferred; `canView` is written to accommodate it).

## Recommendation

1. **Phase 1 (unlisted, opt-in -- the default stays `public`) is shipped.** ~5.5-6.5
   days, removed the public firehose for anyone who opts in (including from their own
   inbox lookup), no general architectural change, no default-behavior change for
   existing tasks, and does not expose a `'private'` task-visibility value that would
   not actually be enforced.
2. Ship **Phase 2 (submission visibility -- default `public`, opt-in
   `reveal_all`/`winner_only`/`never`, locked in at creation)** next -- prioritise it
   over Phase 3, since it directly answers the copying/homogenisation and
   requester-confidentiality complaints, which in practice matter more than task-level
   discoverability. ~7-11 days, including the general read-authentication foundation
   this phase has to build regardless. **Client-side encryption is a non-goal** for now:
   we do not need to hide submissions from the platform, and it would break
   preview/auto-verify/evaluator for no gain on the stated problems. Use S3
   encryption-at-rest if an "encrypted" checkbox is ever needed.
3. Treat **Phase 3 (true private tasks, also opt-in)** as a scoped follow-up gated on a
   separate product decision about whether to build it at all. Because it reuses Phase
   2's read-auth foundation, budget only ~8.5-11.5 additional days rather than a second
   1.5-3 week outlay. Only introduce a `'private'` **task-visibility** value as part of
   this work, once it is genuinely enforced.

## Files this proposal touches

### Phase 1 (unlisted tasks) -- shipped

- `apps/backend/src/db/schema.ts` -- `taskVisibility` column + index
- `apps/backend/drizzle/migrations/0031_add_task_visibility.sql`
- `packages/shared/src/schemas/task.schemas.ts` -- create/response schema fields
- `apps/backend/src/routers/tasks.router.ts` -- list/create gating; `get` stays open
- `apps/backend/src/routers/market.router.ts`, `apps/backend/src/services/stats.ts` --
  exclude unlisted tasks from search/leaderboards/aggregates/activity feed
- `apps/backend/src/services/task-drop-announcements.ts`, `tasks.router.ts`'s `create`
  mutation -- exclude unlisted tasks from Task Drop broadcasts and targeted worker
  notifications
- `apps/backend/src/routers/agents.router.ts` -- exclude `unlisted` tasks from `inbox`
  results by default, plus the narrow signed-message self-auth check for the address's
  own owner
- `apps/backend/src/middleware/ogTags.ts` -- SEO visibility check, both bot-prerender
  list bodies (the single-task OG card stays open, matching direct-fetch)
- `apps/cli/src/commands/task/create.ts` -- `--task-visibility`, plus a changeset
- `apps/cli/src/commands/inbox.ts` -- signs the self-auth message automatically
- `apps/web/components/market/wizard/step-brief.tsx`, `step-publish.tsx` -- toggle,
  disclaimer copy
- `apps/web/components/market/tasks.tsx`, `dashboard-you-view.tsx` -- "Unlisted" badge
- `apps/web/lib/use-inbox-self-auth-signature.ts` -- reuses the
  `wallet.setWithdrawalAddress` signed-message pattern for the dashboard inbox call site
- `apps/backend/scripts/smoke-visibility.ts` -- smoke test
- `apps/docs/src/public/{reference/cli.md,reference/raw-api.md,
  reference/task-schema.md,skill.md}` (mirrored to `pages/`)
- `apps/web/app/sitemap.ts` -- checked, no-op: no per-task URLs exist there today
- `apps/web/components/market/unlisted-badge.tsx` -- shared "Unlisted" badge component,
  replacing three independently hand-rolled copies
- `apps/backend/src/lib/agents.ts` -- `verifySignedAddress`, the single shared
  signature-recovery helper every signed-message self-auth check in the backend now
  uses (`agents.inbox`, `wallet.setWithdrawalAddress`, `wallet.withdrawDreamsRewards`,
  `bids.selectWinner`, `bids.myBids` per ADR-0017, `claims.claim`/`forfeit`,
  `pitches.select`, `submissions.submit`/`requestUploadUrl`/`submitFromKeys`, and the
  legal-acceptance service)
- `apps/backend/src/lib/task-visibility.ts` -- `taskNotUnlisted`/`taskNotUnlistedSql`,
  the shared "exclude unlisted tasks" filter reused everywhere it used to be hand-typed
- `packages/shared/src/lib/authMessages.ts` -- `buildInboxSelfAuthMessage`,
  `buildMyBidsMessage`, alongside the existing `buildSelectWorkerMessage`
- `apps/backend/src/routers/bids.router.ts` -- `myBids` converted from the
  device/API-token header to signed self-auth (ADR-0017); `selectWinner` converted to
  the shared helper

### Phase 2 (submission visibility) -- not started

- `apps/backend/src/trpc.ts`, `context.ts` -- `optionalAuthProcedure`/
  `protectedProcedure`, `ctx.caller` resolution (the shared read-auth foundation)
- `apps/backend/src/db/schema.ts` -- `submissionVisibility` column on `tasks`
  (`'public' | 'reveal_all' | 'winner_only' | 'never'`, default `'public'`)
- `apps/backend/src/routers/submissions.router.ts` -- mode-aware role-gated
  `listByTask` (active-state role check; deterministic post-resolution branch per mode)
- `apps/cli/src/commands/task/create.ts` -- `--submission-visibility`; no separate
  reveal/update command, since the mode is locked in permanently at creation
- `apps/web/components/market/wizard/**` -- `submissionVisibility` control, sharing the
  Phase 1 disclaimer pattern, read-only once the task exists
- `apps/backend/scripts/smoke-submission-visibility.ts` -- new smoke test
- `apps/docs/src/public/{reference/cli.md,reference/raw-api.md,
  reference/task-schema.md,skill.md}` (mirrored to `pages/`) -- `submissionVisibility`
  is new agent-facing behavior and needs the same coverage Phase 1 got, not an
  afterthought

### Phase 3 (true private tasks) -- not started, gated on a separate product decision

- `apps/backend/src/routers/tasks.router.ts` -- `canView` gating on `get` (`NOT_FOUND`)
- `apps/backend/src/routers/{bids,pitches,proofs,feedbacks}.router.ts` -- `canView`
  retrofit (`submissions.router.ts` was already retrofitted in Phase 2)
- `apps/backend/src/db/schema.ts` -- `'private'` added to the `visibility` enum;
  `allowedViewers`-style table for invited workers
- `apps/backend/src/middleware/ogTags.ts` -- generic metadata for a private task's
  detail page, to avoid confirming existence via OG tags
- `apps/web/lib/api/server.ts` -- general authenticated-fetch layer (gated fetch for
  every relevant read, not just the two Phase 1/2 call sites)
