# 0017 — `bids.myBids` re-authenticates via signed self-auth message, not the device/API-token header

> **Decision (Y-statement):** In the context of building `agents.inbox`'s scoped
> self-authentication check (ADR-0015) and comparing it against `bids.myBids`'s existing
> `x-taskmarket-api-token` header, facing the discovery that `devices.register` mints a
> device/API-token pair from a client-supplied wallet address with no signature check at
> all, so the token was never actual proof that its holder controls the address it is
> scoped to, we decided to convert `bids.myBids` from the device-token header to the
> same signed-message self-authentication pattern `agents.inbox` uses (a shared
> `verifySignedAddress` helper verifying a caller-owned-address claim), to achieve a
> single, correct, and consistent mechanism for "prove you own this address" checks
> across the backend, accepting that this is a breaking change to `bids.myBids`'s input
> shape (`deviceId` to `address` + `signature`) with no backward-compatible dual-mode,
> requiring the CLI (its only caller) to be updated in the same change.

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

While drafting ADR-0015's `agents.inbox` self-auth check, `bids.myBids`
(`apps/backend/src/routers/bids.router.ts`, `GET /bids/my`) was cited as the
codebase's other example of "prove who's calling" — gated behind an
`x-taskmarket-api-token` header, verified by `authenticateXmtpDevice`
(`apps/backend/src/services/xmtp-auth.ts`), which looks up a `devices` row by
`deviceId` and compares a hash of the supplied `apiToken`. `bids.myBids` uses the
resulting `device.walletAddress` to scope the query to "my" bids.

Reviewing `devicesRouter.register` (`apps/backend/src/routers/devices.router.ts`)
directly to compare the two mechanisms surfaced a real gap: registration accepts
`{ walletAddress, publicKey }` with **no signature over that address, ever**. Any
caller can register a device claiming any wallet address and receive a valid,
usable `apiToken` for it. The token is not fake or purposeless — it gates a real,
separate capability (server-assisted decryption of the CLI's locally-encrypted
private key via `POST /devices/{deviceId}/key`, plus XMTP/email identity
bookkeeping) — but it was never evidence that its holder controls the address it
is scoped to. `bids.myBids` was therefore never actually verifying "does this
caller own this wallet"; it was only verifying "does this caller hold a
previously-issued token for some device record that happens to list this
address," which anyone could have created for any address in the first place.

This is a narrower, sharper version of the same problem ADR-0015 solved for
`agents.inbox`: a read that should be scoped to "my own data" needs a mechanism
that actually proves address ownership. `agents.inbox`'s signed-message check
(`recoverMessageAddress` over a canonical message, matching the existing
`wallet.setWithdrawalAddress` precedent) is exactly that mechanism, and the
codebase already has it. There is no reason for `bids.myBids` to keep using a
different, weaker one once the correct one exists right next to it in the same
router file.

Unlike `agents.inbox`, `bids.myBids` has no meaningful public/anonymous view — a
list of "my pending bids" has no content to return for an unauthenticated
caller. So where `agents.inbox` treats a missing or invalid signature as a
non-fatal fallback to the public view, `bids.myBids` treats it as a hard
`UNAUTHORIZED`/`BAD_REQUEST` failure.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Convert to the same signed-message self-auth `agents.inbox` uses, via a shared `verifySignedAddress` helper (chosen) | Actually proves address ownership, unlike the token it replaces; consistent with the one real "prove you own this address" mechanism the codebase already has; no new infrastructure, reuses ADR-0015's precedent | Breaking change to `bids.myBids`'s input shape; the only existing caller (the CLI's `inbox` command) must be updated in the same change; no backward-compatible dual-mode was built |
| Keep the device/API-token header as-is (rejected) | No breaking change, no CLI update needed | Never actually verifies ownership -- a device registered (by anyone, for any address, since registration itself is unauthenticated) can read that address's pending bids indefinitely until revoked; leaves a real, if narrow, information-disclosure gap uncorrected once it was found |
| Fix `devices.register` itself to require a signature at registration, keep `bids.myBids` on the token (rejected, out of scope) | Would also close the gap for every other token use (XMTP, email, key decryption), not just this one endpoint | Much larger blast radius: every existing device registration flow (`taskmarket init`) would need to change; does not fully solve it anyway, since a token, once issued, is a static bearer secret with no per-action freshness the way a fresh signature has; a genuinely separate, bigger decision than converting one read endpoint |

## Decision

`bids.myBids`'s input changes from `{ deviceId: string }` to `{ address: string,
signature: string }`. The signature is verified via the shared
`verifySignedAddress` helper (`apps/backend/src/lib/agents.ts`, the same one
`agents.inbox` and every other signed-message check in the backend now uses)
against a canonical message built by `buildMyBidsMessage(address)`
(`packages/shared/src/lib/authMessages.ts`, same pattern as
`buildInboxSelfAuthMessage`). A missing or invalid signature is a hard failure
(`BAD_REQUEST` for a malformed signature, `UNAUTHORIZED` for a valid signature
from the wrong address) — there is no fallback view, since "my bids" has no
public meaning. The CLI's `inbox` command signs this message alongside its
existing `agents.inbox` self-auth signature and sends both in the same command
run.

## Consequences

**Positive:**
- `bids.myBids` now actually verifies the caller owns the address it returns
  data for, closing a real gap the device-token header never covered.
- One consistent mechanism for "prove you own this address" across the backend,
  rather than two — the device/token pattern is no longer used for anything
  that needs to prove ownership, only for what it actually can prove: that the
  caller holds a previously-issued, revocable token (key decryption,
  messaging/email identity).

**Negative / trade-offs:**
- Breaking change: any caller still sending `{ deviceId }` to `GET /bids/my`
  after this ships gets a validation error, not a graceful fallback. The only
  known caller (the CLI) was updated in the same change; there is no telemetry
  on whether any other caller exists.
- The CLI's `inbox` command now signs two messages per run (inbox self-auth,
  my-bids self-auth) instead of one signature plus a stored token, a small
  latency/UX cost in exchange for correctness.

**Neutral / follow-up:**
- This ADR does not fix `devices.register`'s lack of ownership verification at
  registration time. That gap still exists for the device token's legitimate
  uses (key decryption, XMTP, email) — those don't need address-ownership proof
  the way `bids.myBids` did, since they're gated by possession of the token
  itself, not by a claim about which wallet the caller controls. Whether that
  is worth tightening is a separate, larger, and explicitly out-of-scope
  question for this ADR.

## References

- PR #110 — `docs/specs/task-visibility-and-submission-visibility.md`, "What
  `agents.inbox` actually needs" section
- ADR 0015 — Phase 1's `agents.inbox` scoped self-auth (the precedent this
  decision extends to a second endpoint)
- Issue #183 — Phase 1/2/3 implementation tracker
