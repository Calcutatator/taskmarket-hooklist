# 0015 — Phase 1's `agents.inbox` gets a scoped self-auth check, not a general read-auth framework

> **Decision (Y-statement):** In the context of Phase 1 (opt-in unlisted tasks) needing
> some way for a wallet's own owner to see their own unlisted tasks via `agents.inbox`,
> facing the choice between building Taskmarket's general read-authentication framework
> now or deferring it, we decided to add one narrow, scoped signed-message
> self-authentication check on `agents.inbox` alone, reusing the existing
> `wallet.setWithdrawalAddress` precedent, to achieve the minimum real fix without
> pulling forward any of Phase 2's broader read-auth investment, accepting that this
> scoped mechanism will likely need replacing or generalizing once Phase 2 (or Phase 3,
> true private tasks) is built.

- **Status:** Superseded
- **Date:** 2026-07-20
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** Superseded by ADR-0023

## Context

PR #110 identified that `agents.inbox` (`apps/backend/src/routers/agents.router.ts`) has
no way to know who is calling it today — only which wallet address was asked about. A
review pass first concluded `agents.inbox` needed no auth at all (correct for
third-party lookups, since `agents.stats`/`agents.leaderboard` already do the same
public, unauthenticated wallet-reputation lookup by design and this is an intentional
marketplace feature). A second pass caught a real gap in that conclusion: without any
notion of caller identity, an unconditional `'unlisted'` filter would also hide a
wallet's own unlisted tasks from its own owner, everywhere except a saved direct link.
That is tolerable for a CLI or agent (it already has the task ID from its own
create/claim/bid/submit calls) but a genuine break for the web dashboard's "my tasks"
view, which has no other way to enumerate what a connected wallet has done.

The codebase already has a working precedent for a wallet proving it owns an address on
a specific action: `wallet.setWithdrawalAddress` verifies a signed canonical message via
`recoverMessageAddress`. Building Taskmarket's *general* read-authentication framework
(a reusable `ctx.caller`, `optionalAuthProcedure`/`protectedProcedure` wired into
`apps/backend/src/context.ts` and `trpc.ts`, per PR #110's Layer 2) is a separate,
much larger piece of work — the same document estimates it at 4-6 days on its own, the
single largest line item across Phase 2 and Phase 3's combined 1.5-3 week total — and
only pays for itself once Phase 2 (submission visibility) is actually decided and
built, or (failing that) if Phase 3 (true private tasks, requiring `canView`
authorization across ~8 read endpoints) is decided and built instead.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Narrow, scoped self-auth check on `agents.inbox` only (chosen) | Small and bounded (part of Phase 1's ~1-1.5 day Layer 3 budget, not Phase 2's 4-6 day Layer 2); reuses proven precedent (`wallet.setWithdrawalAddress`'s signed-message pattern) rather than inventing a new mechanism; does not commit the codebase to general auth infrastructure before Phase 2 is actually decided | One-off, endpoint-specific mechanism; does not solve "who is asking" for any other endpoint; will likely need replacing or generalizing once Phase 2 (or Phase 3) ships |
| Build the general `ctx.caller`/`optionalAuthProcedure` framework now, as part of Phase 1 (rejected) | Solves the underlying problem once, properly, instead of twice; avoids potentially throwaway scoped work if Phase 2 or Phase 3 later ships | Pulls 4-6 days of Phase-2-scale infrastructure work into what is supposed to be the cheap first ship, speculatively, before Phase 2 is even decided; risks building general auth infrastructure for a feature (true private tasks) that may never ship, per the RFC's own open product question about whether Phase 3 is worth its cost |
| Client-side local tracking of a wallet's own task IDs, no backend auth at all (rejected) | Zero backend change; already fully covers the CLI/agent case | Does not survive a cleared browser or a new device for the web dashboard case, which was the actual gap being closed; explicitly considered and rejected in favor of a server-side fix that survives device changes |

## Decision

`agents.inbox` gets exactly one narrow addition: an optional signed message over a
canonical `taskmarket:inbox:<address>` string (no nonce -- this is a read with no
state-changing side effect, so a replayed signature does nothing a fresh one couldn't),
verified the same way `wallet.setWithdrawalAddress` verifies its own signed message.
When present and valid for the `address` being queried, that address's own `'unlisted'`
tasks are included in the response; when absent or invalid, behavior is unchanged from
today (public tasks only, for any address, no error). No `ctx.caller`, no context-level
auth framework, no change to any other read endpoint. The general read-authentication
framework remains exclusively Phase 2 scope, to be built only if and when Phase 2 is
separately decided.

## Consequences

**Positive:**
- Phase 1 stays meaningfully cheaper than Phase 2 and Phase 3 combined (~5.5-6.5 days
  vs. ~1.5-3 weeks total) rather than absorbing that cost speculatively.
- No premature investment in general read-auth infrastructure that Phase 2 or Phase 3
  might end up needing built differently once each phase's own scope (the submission
  role-check truth table in Phase 2; worker-invite discovery and `canView` semantics for
  multi-worker `task_awards` rows in Phase 3) is actually worked out.
- Reuses an existing, proven verification pattern instead of inventing a new one.

**Negative / trade-offs:**
- If Phase 2 (or Phase 3) ships, this scoped check likely gets superseded by the general
  framework rather than extended — accepted as a reasonable amount of throwaway work in
  exchange for not over-building now.

**Neutral / follow-up:**
- This ADR does not decide whether Phase 3 (true private tasks) is ever built — that
  remains an open product question per PR #110's "Risks and open questions" section.
- The signature-recovery logic behind this check was later extracted into a single
  shared `verifySignedAddress` helper (`apps/backend/src/lib/agents.ts`), reused by
  every backend endpoint that verifies a caller-owned-address claim this way (see
  ADR-0017 for `bids.myBids`'s conversion onto the same pattern). `agents.inbox` is
  therefore no longer the only read endpoint with a notion of caller identity, though it
  remains true that this ADR did not build a general, context-level auth framework --
  each such endpoint still runs its own narrow, self-contained check.

## References

- PR #110 — `docs/rfc/0005-task-visibility-and-submission-visibility.md`, "What `agents.inbox` actually needs"
  section
- Issue #183 — Phase 1 implementation tracker
- ADR 0014 — the related decision that visibility stays public-by-default/opt-in
- ADR-0023 — supersedes this decision: `agents.inbox` converges onto the general
  `ctx.caller` read-auth mechanism, exactly as the "Negative / trade-offs" section above
  anticipated.
