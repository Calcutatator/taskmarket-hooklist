# 0030 — Private tasks grant access via both wallet allowlist and password, discovered in-app via `agents.inbox`, using an opaque bearer receipt

> **Decision (Y-statement):** In the context of Phase 3 (true private tasks) needing to
> decide what invite mechanism(s) to support and how a password-granted (non-wallet)
> caller proves access on subsequent reads, facing the fact that the RFC
> (`docs/rfc/0005-task-visibility-and-submission-visibility.md`) left both questions
> explicitly open, we decided to support both a wallet allowlist and a password
> simultaneously (requester's choice, either or both, combinable on one task), surface
> allowlist invites in-app via a new `invitedPrivateTasks` field on the existing
> `agents.inbox` self-auth response, and implement the password path as a stateful
> opaque bearer receipt (`task_access_grants`, mirroring ADR-0009's
> `legal_access_receipts`) rather than a stateless HMAC-signed token, to achieve real
> access control for people without a registered wallet plus discoverability for invited
> wallets without relying solely on a shared direct link, accepting the added DB
> round-trip per gated request when the grant header is present and the small new schema
> surface (two new tables plus a rate-limit table).

- **Status:** Accepted
- **Date:** 2026-07-24
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

The RFC scoped Phase 3 as "the task itself is not viewable by anyone but the requester
and invited/assigned workers... password-protected or scoped to an explicit wallet
allowlist, so only specific wallets can see the task in listings," but deliberately left
the choice between the two mechanisms — and the harder question of how a password-only
caller (who has no wallet to sign a read-auth message with) proves access on every
subsequent read — as "a separate product decision," gated on whether to build Phase 3 at
all. That decision was made in a planning conversation for issue #183, alongside the
decision to build the full stack (backend, CLI, web) in one pass rather than deferring
web to a follow-up.

Two things are new relative to Phase 2's `ctx.caller` foundation (ADR-0016), which this
phase otherwise reuses in full:

1. **A password is not a wallet identity.** The entire existing read-auth mechanism
   (`ctx.caller`, `X-Taskmarket-Caller-Address`/`-Signature`) proves "I control this
   wallet." A password proves nothing about a wallet at all — it needs its own bearer
   proof, resolved as a separate `ctx.taskAccessGrant` field rather than folded into
   `Caller`.
2. **Discovery.** The RFC's own "Risks and open questions" section flags "how does an
   invited worker learn of it?" as unresolved, listing an invite/`allowedViewers`
   mechanism as deferred. `agents.inbox` already has exactly the self-auth mechanism
   (ADR-0015, superseded by ADR-0023) an invite-discovery feature needs: prove you own
   an address, see what's relevant to that address.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| **Both mechanisms + in-app inbox surfacing + opaque receipt (chosen)** | Real access control for collaborators without a registered wallet yet (password), plus the stronger, revocable wallet-identity path for known collaborators (allowlist); invited wallets discover access without depending entirely on the requester remembering to share a link; the receipt shape has a direct, proven precedent in this codebase | More surface area than a single mechanism: two schema additions (`task_allowed_viewers`, `task_access_grants`) plus a rate-limit table, and both a `ctx.caller` path and a `ctx.taskAccessGrant` path through `canView` |
| Wallet allowlist only (rejected) | Simplest -- reuses `ctx.caller` exclusively, no new bearer-token concept at all | No path for a collaborator who doesn't have a wallet registered yet; forces every private-task use case through wallet onboarding first, which the RFC's own framing ("password-protected or... wallet allowlist") never intended as the only option |
| Stateless HMAC-signed token instead of a DB-backed receipt (rejected) | No new table; no DB round-trip on verify | No revocation or audit trail (a leaked or compromised password-derived token can't be individually invalidated without also rotating a server-wide secret and breaking every other outstanding grant); this codebase already has a proven, simpler-to-reason-about precedent for exactly this shape (`legal_access_receipts`, ADR-0009) that trades a small DB read for real revocability |
| Allowlist-only discovery via shared link, no in-app notification (status quo default, rejected) | Zero new discovery-mechanism work | Leaves an invited wallet with no way to find a private task except a link the requester has to remember to send, directly contradicting the point of adding a wallet-allowlist mechanism at all |

## Decision

A private task (`tasks.taskVisibility = 'private'`) may configure a wallet allowlist
(`task_allowed_viewers`, mutable after creation via `taskAccess.addAllowedViewer`/
`removeAllowedViewer`), a password (`tasks.privateAccessPasswordHash`, set only at
creation, matching `submissionVisibility`'s "locked in permanently" precedent), or both —
`TaskCreateSchema` requires at least one when `taskVisibility === 'private'`. The
password path never distinguishes "wrong password" from "no password set" or "task not
found" in its error response (`taskAccess.verifyPassword` always returns a generic
`UNAUTHORIZED`), matching the "don't confirm existence" posture already established for
`unlisted` tasks. `canView(task, caller?, context?)` (`apps/backend/src/lib/task-visibility.ts`)
is the single predicate both paths funnel through: true for the requester, `claimedBy`,
any `task_awards`-linked worker, any allowlisted wallet, or a caller presenting a
`taskAccessGrant` scoped to that exact `taskId`.

`agents.inbox`'s response gains `invitedPrivateTasks`, populated only when the caller
proves address ownership (the same `selfAuthed` check ADR-0023 already established for
`asRequester`/`asWorker`) via a join against `task_allowed_viewers` — reusing the
existing self-auth mechanism and response shape rather than building a notification
center.

## Consequences

**Positive:**
- Both invite mechanisms are available from day one, matching the RFC's own framing
  rather than picking one arbitrarily and closing off the other as a later addition.
- The password path's opaque-receipt shape has a working precedent in this codebase
  (`legal_access_receipts`/`issueLegalReceipt`/`verifyLegalReceipt`) to copy exactly,
  rather than inventing and re-reviewing a new bearer-token scheme from scratch.
- An invited wallet has a real, in-app path to discover a private task it's been added
  to, without depending on the requester separately messaging a link.

**Negative / trade-offs:**
- Every gated read that might touch a private task now has two possible proofs to check
  (`ctx.caller` and `ctx.taskAccessGrant`), not one — `canView`'s signature and every one
  of its callers carries both.
- `taskAccess.verifyPassword` is a public, unauthenticated endpoint accepting a raw
  password guess; it requires its own rate limiter (`task_access_password_rate_limits`,
  modeled on `task_drop_subscribe_rate_limits`) to avoid unlimited brute-force attempts,
  which is additional scope the wallet-only alternative would not have needed.
- Password rotation is out of scope for this pass — a password is set once at creation
  with no update path, an explicit open question left for future follow-up work rather
  than silently foreclosed.

**Neutral / follow-up:**
- `apps/backend/src/lib/task-access-password.ts` (scrypt hash/verify, rate limiter),
  `apps/backend/src/lib/task-access-grants.ts` (issue/verify), `apps/backend/src/routers/
  task-access.router.ts` (`verifyPassword`/`addAllowedViewer`/`removeAllowedViewer`/
  `listAllowedViewers`), `apps/backend/src/context.ts` (`resolveTaskAccessGrant`,
  `Context.taskAccessGrant`), `apps/backend/src/lib/task-visibility.ts` (`canView`,
  `taskDiscoverable`, `fetchPrivateViewabilityContext(ForTasks)`,
  `resolveTaskViewability`), `apps/backend/src/lib/submission-visibility.ts`
  (`canViewSubmission` now composes `canView`), `apps/backend/src/routers/agents.router.ts`
  (`inbox`'s `invitedPrivateTasks` branch), migration `0036_add_private_tasks.sql`.

## References

- `docs/rfc/0005-task-visibility-and-submission-visibility.md` — the RFC that scoped Phase
  3 and explicitly deferred both decisions this ADR resolves.
- ADR-0009 (legal acceptance opaque receipt, default-deny middleware) — the precedent
  this ADR's password-grant mechanism copies.
- ADR-0016 (submission visibility, independent axis) — the `ctx.caller` read-auth
  foundation this phase reuses rather than rebuilding.
- ADR-0023 (converge `agents.inbox`/`bids.myBids` onto the general read-auth header) —
  the self-auth mechanism `invitedPrivateTasks` reuses.
- ADR-0031 — the companion decision on how the web app's SSR layer handles a private
  task's gated content.
