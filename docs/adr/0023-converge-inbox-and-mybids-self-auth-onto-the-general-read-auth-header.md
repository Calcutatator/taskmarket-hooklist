# 0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header

> **Decision (Y-statement):** In the context of Phase 2 (ADR-0016) having built a
> general "prove you own this address for a read" mechanism (`ctx.caller`, a signed
> `taskmarket:read:<address>` message sent as `X-Taskmarket-Caller-Address`/
> `X-Taskmarket-Caller-Signature` headers) that Phase 3 (true private tasks) will need
> for even more endpoints, facing the fact that `agents.inbox` and `bids.myBids` already
> each implement their own narrower, mutually incompatible version of that same proof,
> we decided to converge all three onto the one general mechanism and deprecate the two
> bespoke schemes, to achieve one consistent verification path for every current and
> future gated-read endpoint instead of three, accepting that this is a breaking change
> to `agents.inbox`'s and `bids.myBids`'s request shape, requiring the CLI and web app's
> callers to be updated in the same change.

- **Status:** Accepted
- **Date:** 2026-07-22
- **Embodiment:** Implemented
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** Supersedes ADR-0015; Supersedes ADR-0017

## Context

ADR-0015 built `agents.inbox`'s scoped self-auth (a signed `taskmarket:inbox:<address>`
message, sent as `signature`/`address` query parameters) as a deliberately narrow,
one-endpoint fix, explicit that it "will likely need replacing or generalizing once
Phase 2 (or Phase 3, true private tasks) is built." ADR-0017 then converted
`bids.myBids` to its own, similarly narrow signed-message scheme (`taskmarket:bids:my:
<address>`, sent as `address`/`signature` **body/query input fields**, verified via
`verifySignedAddressOrThrow`).

Phase 2 (ADR-0016, PR #210) has now shipped exactly the general mechanism ADR-0015
predicted would eventually be needed: `ctx.caller`, resolved once per request in
`apps/backend/src/context.ts` from a signed `taskmarket:read:<address>` message sent as
the `X-Taskmarket-Caller-Address`/`X-Taskmarket-Caller-Signature` HTTP headers, with no
nonce (reads have no state-changing side effect to replay). Five submissions-router
endpoints already use it (`listByTask`, `previewArtifact`, `download`, `listByWorker`,
`mySubmissions`).

The result today is **three different "prove you own this address" schemes live at
once**, for the same underlying claim:

| Endpoint | Message | Transport | Verified by |
|---|---|---|---|
| `agents.inbox` | `taskmarket:inbox:<address>` | `signature`/`address` query params | `verifySignedAddress` (soft-fail to anonymous) |
| `bids.myBids` | `taskmarket:bids:my:<address>` | `address`/`signature` input fields | `verifySignedAddressOrThrow` (hard-fail) |
| `submissions.*` (Phase 2) | `taskmarket:read:<address>` | `X-Taskmarket-Caller-*` headers | resolved once in `context.ts`, soft-fail to anonymous |

This is directly visible in `apps/cli/src/commands/inbox.ts`, which signs **two separate
messages with the same wallet** in parallel for one CLI command:

```ts
account?.signMessage({ message: buildInboxSelfAuthMessage(address) }),
account?.signMessage({ message: buildMyBidsMessage(address) }),
```

and in the web app, which has a dedicated `apps/web/lib/use-inbox-self-auth-signature.ts`
hook just for the `inbox` scheme (no equivalent exists for `myBids` today — it has no web
caller). A worker wanting the "as me" view everywhere therefore needs to reason about
three message formats, three transports, and two different fail-open/fail-closed
behaviors, for what is conceptually one claim: "I am the owner of address X, prove it
for this read." Phase 3 (private tasks) will add `canView` gating to `tasks.get` and a
`canView` retrofit across `bids`/`pitches`/`proofs`/`feedbacks` routers per the RFC's own
Phase 3 file list — each of those is another candidate to either duplicate this pattern
a fourth/fifth/sixth time, or converge it now while there are still only two bespoke
schemes to migrate instead of five.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| **Converge `inbox`/`myBids` onto `ctx.caller`, deprecate the two bespoke message schemes** | One verification path for every gated read, present and future; removes `buildInboxSelfAuthMessage`/`buildMyBidsMessage` and their bespoke query-param plumbing; CLI's `inbox` command signs one message instead of two | Breaking change to `agents.inbox`/`bids.myBids`'s request shape; requires updating the CLI and the web app's `use-inbox-self-auth-signature.ts` hook in lockstep; `bids.myBids`'s hard-fail-on-invalid-signature behavior needs a decision on whether to preserve that strictness under the new (currently soft-fail) header mechanism, or make `ctx.caller` support both modes |
| Leave `inbox`/`myBids` as-is; only use `ctx.caller` for new Phase 3 endpoints (rejected) | Zero migration cost now, no breaking change | Locks in three-and-growing incompatible schemes indefinitely; every future gated-read endpoint (Phase 3's `canView` retrofit across four more routers) either duplicates the pattern again or the codebase permanently carries multiple ways to do the same thing; directly contradicts what ADR-0015 already flagged as the expected outcome |
| Make `ctx.caller` accept query-param signatures too, as an alternate input path, without touching `inbox`/`myBids`'s existing code (rejected) | No breaking change to existing endpoints | Doesn't reduce the number of code paths at all -- just adds a second accepted transport to `context.ts`, making the "one mechanism" property false in practice; treats the symptom (three transports) without touching the actual duplication (three near-identical verify-and-recover blocks) |

## Decision

Adopted the first option: `agents.inbox` and `bids.myBids` converge onto `ctx.caller`,
in this same PR (#210), rather than waiting for Phase 3 scoping. `agents.inbox` becomes
an `optionalAuthProcedure` whose `selfAuthed` check compares `ctx.caller?.address`
against the queried `address` (soft-fail to the public view, unchanged from ADR-0015).
`bids.myBids` becomes a `protectedProcedure` that throws `UNAUTHORIZED` when `ctx.caller`
is absent and derives the address from `ctx.caller.address` rather than an
`address`/`signature` input pair, preserving ADR-0017's hard-fail behavior under the new
mechanism. `buildInboxSelfAuthMessage`/`buildMyBidsMessage` and the `signature` field on
`TaskInboxInputSchema` are removed from `packages/shared`. The CLI's `inbox` command now
signs one `taskmarket:read:<address>` message via the shared `signReadAuth()` helper and
sends it as the `X-Taskmarket-Caller-*` headers to both `/api/agents/inbox` and
`/api/bids/my`, instead of signing two separate messages. The web app's
`use-inbox-self-auth-signature.ts` hook is replaced by `use-read-auth-signature.ts`,
which caches the signed headers (`lib/read-auth.ts`) for the tRPC client to attach
globally rather than passing a signature through query input.

## Consequences

**Positive (if accepted):**
- Every "prove you own this address for a read" check in the backend goes through one
  function (`resolveCaller` in `context.ts`), not three.
- `apps/cli/src/commands/inbox.ts` signs one message instead of two.
- Phase 3's `canView` retrofit across `bids`/`pitches`/`proofs`/`feedbacks` starts from a
  single existing pattern to extend, instead of choosing between three precedents.
- `buildInboxSelfAuthMessage`/`buildMyBidsMessage` and their associated query-param
  schemas can be deleted from `packages/shared`.

**Negative / trade-offs:**
- Breaking change to `agents.inbox` (`signature`/`address` query params removed) and
  `bids.myBids` (`address`/`signature` input fields removed), requiring coordinated
  CLI + web updates in the same PR (#210), not a gradual migration.
- `bids.myBids` is now a `protectedProcedure`, throwing `UNAUTHORIZED` when `ctx.caller`
  is absent, preserving ADR-0017's original hard-fail behavior under the new mechanism.
- `apps/web/lib/use-inbox-self-auth-signature.ts` was replaced by
  `use-read-auth-signature.ts` (and `lib/read-auth.ts`'s module-level header cache, read
  globally by the tRPC client), with equivalent test coverage to Phase 2's CLI/backend
  read-auth tests.

**Neutral / follow-up:**
- Implemented in this same PR (#210): `apps/backend/src/routers/agents.router.ts`,
  `bids.router.ts`, `packages/shared/src/lib/authMessages.ts`, `task.schemas.ts`,
  `apps/cli/src/commands/inbox.ts`, `apps/web/lib/read-auth.ts`/`use-read-auth-signature.ts`,
  plus the corresponding unit and smoke tests (`smoke-visibility.ts`, `smoke-bids-inbox.ts`).
- ADR-0015 and ADR-0017 are marked Superseded by this ADR, since their scoped mechanisms
  no longer exist in the code -- both remain in place as historical record per the ADR
  process, cross-linked from here.

## References

- ADR-0015 (`agents.inbox` scoped self-auth) -- explicitly anticipated this follow-up;
  superseded by this ADR.
- ADR-0017 (`bids.myBids` signed self-auth) -- same; superseded by this ADR.
- ADR-0016 (submission visibility, independent axis) -- the PR that shipped the general
  `ctx.caller` mechanism this ADR converges onto.
- `docs/rfc/0005-task-visibility-and-submission-visibility.md` -- Phase 3 file list already
  plans a `canView` retrofit across `bids`/`pitches`/`proofs`/`feedbacks.router.ts`, which
  now starts from this single converged pattern instead of three precedents.
