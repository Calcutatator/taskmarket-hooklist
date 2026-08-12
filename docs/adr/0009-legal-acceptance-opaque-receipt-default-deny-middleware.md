# 0009 — Legal acceptance is enforced by an opaque bearer receipt checked by default-deny middleware

> **Decision (Y-statement):** In the context of gating new marketplace activity on legal
> acceptance across web, CLI, and raw-API clients, facing the need for one enforcement point
> that works uniformly for Privy-authenticated web users and wallet-signing CLI/API clients
> without re-implementing verification in every router, we decided to issue clients an opaque
> random bearer receipt (only its SHA-256 hash stored server-side) that must accompany every
> protected write, checked by a single global Express middleware mounted ahead of all routers
> and tRPC procedures that denies by default unless a route is explicitly listed as exempt, to
> achieve one auditable enforcement boundary that new endpoints inherit automatically, accepting
> that any endpoint which should *not* require acceptance must be manually added to an
> exemption allowlist or it will be wrongly gated.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Accepted:** 2026-07-17
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

PR #165 adds a versioned legal-acceptance system that must gate new marketplace activity
across three very different client shapes: browser sessions authenticated via Privy, the CLI
signing with a local wallet key, and raw API/agent callers doing the same over HTTP. Whatever
enforcement mechanism was chosen had to work identically for all three without coupling to
any one client's session mechanism, and had to apply consistently to every current and future
protected route without requiring each router author to remember to wire it in by hand.

The implementation that shipped: `POST /api/legal/accept*` returns a random
`tmlegal_<base64url>` token to the client; only its SHA-256 hash is ever persisted
(`legal_access_receipts.tokenHash`). Clients attach the raw receipt on every subsequent request
via the `X-Taskmarket-Legal-Receipt` header. A single `createLegalAccessMiddleware` is mounted
in `apps/backend/src/app.ts` before every router and tRPC procedure; it looks up the exact
route or procedure name against two hardcoded allowlists (`EXIT_OR_PUBLIC_WRITE_ROUTES`,
`EXIT_OR_PUBLIC_TRPC_PROCEDURES`) and, if not listed, requires a valid, subject-matching
receipt or returns `403 LEGAL_ACCEPTANCE_REQUIRED`.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Opaque bearer receipt + global default-deny middleware (chosen) | One enforcement point for all three client types; new endpoints are protected by default with no per-route work; the receipt is a plain header, so it composes with X402 payment signatures and Privy tokens without interfering with either | A new endpoint that should be public/exempt must be added to the allowlist by hand, or it is wrongly blocked; the allowlist is matched by exact path/procedure string, so a route rename silently drops out of it — but that failure is itself safe: the renamed route falls back to protected-by-default, not exempt, so the mistake costs a wrongly-blocked request, never a silent gap |
| Per-procedure opt-in decorator (e.g. a `requireLegalAcceptance()` tRPC middleware wrapper applied at each call site) (rejected) | Explicit and self-documenting at the call site; a genuinely public route can never be accidentally gated | Easy to forget adding the wrapper to a *new protected* route, which is the opposite failure mode and strictly worse: it silently ships a security gap (unprotected activity) instead of a visible one (a wrongly-blocked request that fails loudly in testing). To cover the ~150 *existing* procedures safely, the currently-ubiquitous default builder would also need renaming across every router file so the gated one becomes the default — a sweeping, unrelated-file rename comparable in size to the allowlist it would replace, without removing the maintenance burden |
| Exemption declared as `.meta({ legalExempt: true })` on each tRPC procedure instead of a separate allowlist (rejected for now) | Exemption lives at the route definition itself rather than a separately maintained list, so it can't drift from a rename the way a string-matched list can | REST `/api/...` requests are auto-generated from tRPC procedures via `trpc-to-openapi`, not hand-written Express routes, so the middleware would need new machinery to resolve an incoming REST path back to the originating procedure's meta before it could read `legalExempt` — real new complexity and risk for marginal benefit over the current allowlist, whose only failure mode already fails safe (see above) |
| Re-derive acceptance status from a signed session/JWT claim instead of an opaque receipt (rejected) | No server-side hash lookup per request | Ties legal-acceptance state to a specific auth/session mechanism; CLI and raw-API wallet callers have no session cookie, so this would need a second, parallel mechanism anyway, defeating the goal of one uniform check |

## Decision

Ship the opaque-receipt-plus-global-default-deny-middleware model exactly as implemented:
`apps/backend/src/services/legal.ts` (receipt issuance/verification),
`apps/backend/src/middleware/legal-access.ts` (the allowlist and the per-request check), wired
into `apps/backend/src/app.ts` ahead of all routers and tRPC procedures. Any future protected
endpoint is gated by default; making it exempt is an explicit, reviewable addition to the
allowlist, not the default state.

## Consequences

**Positive:**
- New backend endpoints are gated by default, so a forgotten exemption fails closed (blocks a
  legitimate public route, caught immediately by testing) rather than failing open (silently
  exposes a protected action).
- The same header-based receipt works unmodified across web, CLI, and any future raw-API
  client, with no client-specific enforcement path to keep in sync.
- The receipt composes cleanly with X402 payment signatures and Privy bearer tokens — none of
  the three headers needs to know about the others.

**Negative / trade-offs:**
- The allowlist (`EXIT_OR_PUBLIC_WRITE_ROUTES` / `EXIT_OR_PUBLIC_TRPC_PROCEDURES`) is matched
  by exact path/procedure string; renaming a route requires remembering to update the
  allowlist entry in the same change, with no compiler-enforced link between the two.
- The wallet-subject binding check inside the middleware (matching an accepted wallet against
  the request's acting wallet) relies on a hardcoded list of known body field names
  (`ACTING_WALLET_FIELDS`); a future endpoint using a differently-named field silently gets no
  binding check unless that field name is added to the list.

**Neutral / follow-up:**
- `LEGAL_ENFORCEMENT_ENABLED` currently gates the entire middleware off, so none of this is
  live in production yet; the operational activation checklist lives in
  `docs/LEGAL_ACCEPTANCE.md`.

## References

- `docs/LEGAL_ACCEPTANCE.md`
- PR #165 — Add versioned legal acceptance across web, API, and CLI
