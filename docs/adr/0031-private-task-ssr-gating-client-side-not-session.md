# 0031 — Phase 3's private-task SSR gating is a client-side access gate, not a persisted wallet session

> **Decision (Y-statement):** In the context of Phase 3 needing the web app's
> server-rendered task detail page to react to caller identity for the rare private-task
> case, facing the fact that no session/cookie/JWT bridge exists anywhere in this
> codebase between a connected wagmi wallet and a Next.js Server Component fetch, we
> decided to keep `fetchTask`/SSR unauthenticated for the common (public) case and add a
> inline client-side gate rendered directly by the page component (reusing the existing
> `useReadAuthSignature` wallet-signature pattern plus a new password-unlock flow) for
> the private-task case, rather than building a general authenticated-fetch SSR session
> layer, to achieve zero new session infrastructure and an unaffected SSR path for the
> public-task majority, accepting that a private task's first paint is a generic
> "not found/private" state until the client-side gate resolves rather than a fully
> server-rendered detail view.

- **Status:** Accepted
- **Date:** 2026-07-24
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

The RFC's Layer 6 (Web app) section is explicit that Phase 2 did not build a general
authenticated-fetch layer, only two narrow call sites (`dashboard-you-view.tsx`'s
`useReadAuthSignature` hook), and flags that "Phase 3 would additionally require the web
app to gain a notion of a logged-in reader for *every* gated fetch, which it still lacks
after Phase 2... budget that separately if Phase 3 is pursued." Investigating this
directly (rather than assuming) confirmed the gap is real and total: `apps/web/lib/
api/server.ts`'s `readJson`/`makeServerTrpcClient` send zero auth headers of any kind,
and both `apps/web/app/(public)/tasks/[taskId]/page.tsx` and `apps/web/app/dashboard/
tasks/[taskId]/page.tsx` are plain `async` Server Components with no cookie, session, or
wallet-address parameter available at fetch time. Wallet connection in this app is
client-side-only via wagmi; nothing today persists that connection to anything a Server
Component can read.

This is a materially different kind of problem than adding a new field to an existing
authenticated fetch (which Phase 1 and Phase 2 both did, at the two call sites above): it
would require inventing a persisted-identity bridge (most plausibly a Sign-In-With-
Ethereum-style session, backed by a cookie or JWT minted from an initial wallet
signature) that does not exist anywhere in this codebase, for a feature — true private
tasks — that is itself opt-in and expected to be the rare case, not the common path SSR
exists to optimize for.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| **Client-side access gate rendered inline by the page component (chosen)** | No new session infrastructure; reuses `useReadAuthSignature`, a pattern already proven in `dashboard-you-view.tsx`; SSR stays simple and fast for the overwhelming public-task majority; a private task's non-viewable response (`tasks.get` returning `null`) already matched the existing `if (!task) ...` branch, just swapping what it renders | A private task's first paint is a generic "not found/private" state, not the fully server-rendered detail view a public task gets, until the client-side gate resolves (wallet signature or password entered); Next.js's route-segment `not-found.tsx` special file does not receive the dynamic route's `params`, so the gate must be rendered inline in `page.tsx` rather than via that mechanism, confirmed while implementing this decision |
| General cookie/JWT-backed wallet session (Sign-In-With-Ethereum style) covering every SSR read (rejected) | Would make every SSR fetch caller-aware uniformly, closing the gap the RFC flags for good | New, security-sensitive infrastructure (session issuance, storage, expiry, CSRF/XSS considerations) that does not exist anywhere in this codebase today; the RFC's own Layer 6 notes this "still needs to quantify and build that separately" rather than treating it as free; disproportionate cost for a feature scoped as the rare, opt-in case |
| Drop SSR for task detail pages entirely, fetch everything client-side (rejected) | Sidesteps the SSR identity gap by not having SSR data-fetch identity at all | Breaks SEO and OG-tag rendering for the overwhelming public-task majority (the exact problem `ogTags.ts`'s bot-prerender path exists to solve) for no benefit to the rare private-task case |

## Decision

`apps/web/lib/api/server.ts` stays unauthenticated. A private task a caller can't view
already returns `null` from `tasks.get` (per `canView`'s design, indistinguishable from a
genuinely missing task), same as before this phase. Both `(public)/tasks/[taskId]/
page.tsx` and `dashboard/tasks/[taskId]/page.tsx` used to call Next.js's `notFound()` on
that `null`; they now render a new client component (`private-task-access-gate.tsx`)
inline instead, passing the route's `taskId` down as a prop -- Next.js's route-segment
`not-found.tsx` special file does not receive the dynamic route's `params`, so rendering
inline in `page.tsx` is the only way to get `taskId` to the gate. The gate offers "connect
wallet" (`useReadAuthSignature`, unchanged) and "enter password" (`taskAccess.
verifyPassword`), then refetches client-side via the same `TaskDetailPanel` component a
server-rendered page would have used, once either proof succeeds. `generateMetadata`
needs no change: it already falls back to generic "Task not found" metadata when
`fetchTask` returns `null`, which is exactly the non-leaking behavior a private task's
`<title>`/OG tags need too.

## Consequences

**Positive:**
- Zero new session/cookie/JWT infrastructure. The only new client-side primitive is a
  `taskId`-keyed grant cache (`apps/web/lib/task-access-grants.ts`), parallel to the
  existing single-slot `read-auth.ts` cache but keyed per task since a session could
  plausibly hold grants for more than one private task at once.
- SSR performance and simplicity for the public/unlisted majority is completely
  unaffected — this decision adds no overhead to the common path.
- The gate reuses a proven pattern (`useReadAuthSignature`) instead of inventing a new
  one, and composes with the password flow via the same `taskAccess.verifyPassword`
  endpoint the CLI's `task unlock` command calls.

**Negative / trade-offs:**
- A private task's first paint is a generic not-found-shaped state rather than a fully
  server-rendered detail page, even for a caller who is fully entitled to view it (e.g.
  the requester revisiting their own task) — the entitled view only appears after a
  client-side round trip (wallet signature or password entry) completes.
- The global `httpBatchLink` in `apps/web/lib/api/client.tsx` is not call-aware, so it
  cannot cleanly attach a *different* grant header per distinct `taskId` if multiple
  private tasks' queries were ever batched together; the gate component is expected to
  use its own non-batched request path (e.g. `httpLink` or a one-off `fetch`) scoped to
  its single `taskId`, an implementation detail to confirm against the installed tRPC
  client version rather than something this ADR resolves.

**Neutral / follow-up:**
- If a future need justifies it, a general SIWE-style session layer remains a legitimate
  follow-up ADR of its own — this decision does not foreclose it, it just declines to
  build it now for a feature scoped as the rare case.

## References

- `docs/rfc/0005-task-visibility-and-submission-visibility.md` — Layer 6's explicit note
  that Phase 2 did not build a general authenticated-fetch layer and that Phase 3 would
  need to budget for one separately if pursued.
- ADR-0030 — the companion decision on the private-task invite mechanisms this gate's
  two affordances (wallet, password) correspond to.
- ADR-0016 — the `ctx.caller`/read-auth foundation `useReadAuthSignature` already builds
  on.
