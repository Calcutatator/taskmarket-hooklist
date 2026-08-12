# 0018 — `devices.register` requires a signature proving address ownership before minting a token

> **Decision (Y-statement):** In the context of a deep-review finding on PR #110 showing
> that `devices.register`'s unauthenticated `walletAddress` claim lets an attacker
> overwrite a victim's `agents.publicKey` via `agents.setPublicKey` (not merely gain a
> token "gated by possession", as ADR-0017 characterized the residual risk), facing the
> need to close a real key-substitution vector before `make release`, we decided to
> require the caller to sign a canonical challenge message with the private key for the
> claimed `walletAddress` before `devices.register` mints a device/API token or accepts a
> `publicKey`, using the same `verifySignedAddressOrThrow` mechanism ADR-0017 and
> `wallet.router.ts` already established, to achieve actual proof of address ownership at
> the one place every device-token capability originates from, accepting that this is a
> breaking change to `devices.register`'s input shape requiring both CLI call sites
> (`init.ts`, `wallet/import.ts`) to sign before registering in the same change.

- **Status:** Accepted
- **Date:** 2026-07-20
- **Accepted:** 2026-07-20
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

ADR-0017 documented, as a "Neutral / follow-up" and explicitly out of scope, that
`devices.register` (`apps/backend/src/routers/devices.router.ts`) mints a device/API
token from a client-supplied `walletAddress` with no signature check at all, and
reasoned that this was an acceptable residual risk because the token's legitimate uses
(key decryption, XMTP, email) "are gated by possession of the token itself, not by a
claim about which wallet the caller controls."

A deep review of PR #110 after merge found that framing understates the actual risk.
`devices.register` does not just mint an inert token — when called with an optional
`publicKey`, it writes that key directly into `agents.publicKey` for the claimed address
(lines 63-68 for an existing agent row, 74-86 for a new one), no proof of ownership
required. Separately, `agents.setPublicKey` (`apps/backend/src/routers/agents.router.ts:422-469`)
trusts `deviceId` + `apiToken` alone — the same unauthenticated token from
`devices.register` — to overwrite `agents.publicKey` for `device.walletAddress`.

Chained together: an attacker calls `devices.register({ walletAddress: victim,
publicKey: attackerKey })` (or omits the key at registration and calls `setPublicKey`
right after with the token they were handed) and overwrites the victim's published
ECIES public key with one the attacker controls. `agents.publicKey`
(`apps/backend/src/routers/agents.router.ts:392-420`) is the sole source client code
queries before encrypting a message "to" that address — the CLI's `wallet publish-key` /
encrypted-inbox flow trusts whatever is stored there. The result is a real
key-substitution attack: any message encrypted to the victim after the overwrite is
actually encrypted to the attacker, with the encrypting party having no way to detect
the substitution. This is not "gated by possession of a token" in any meaningful sense
— the token itself is trivially self-issued for any address, so possessing it proves
nothing about the caller.

This is architecturally the same shape of problem ADR-0015 and ADR-0017 already solved
for `agents.inbox` and `bids.myBids`: a capability scoped to "this address" needs actual
proof the caller controls that address, not a claim taken at face value. The difference
is that `devices.register` sits upstream of every device-token capability (key
decryption, XMTP, email, and now confirmed: public-key publication), so fixing it here
closes the gap at its origin rather than at each downstream consumer individually — the
option ADR-0017 rejected as "much larger blast radius" is, on reflection, the more
correct fix precisely because the blast radius is the actual bug.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Require a signature over a canonical challenge message at `devices.register` time, verified via the existing `verifySignedAddressOrThrow` helper, before minting a token or writing `publicKey` (chosen) | Closes the gap at its single point of origin — every downstream capability (key decryption, XMTP, email, public-key publication) inherits the fix for free; reuses existing, already-reviewed infrastructure (`verifySignedAddressOrThrow`, the `taskmarket:<action>:<address>` message convention); both CLI call sites (`init.ts`, `wallet/import.ts`) already hold a local signer at the point they call `registerDevice` (confirmed by reading both), so no new capability is needed client-side, only a signature call | Breaking change to `POST /devices`'s input shape; both CLI call sites need a coordinated update in the same change; any third-party integration calling `devices.register` directly (not through this CLI) breaks with no deprecation window |
| Leave `devices.register` unauthenticated; instead require a signature specifically inside `agents.setPublicKey` and the inline `publicKey` write in `devices.register` (narrower, rejected) | Smaller surface area to change; doesn't touch the token-minting path at all | Only closes the one exploit chain found so far; leaves the same unauthenticated-claim pattern open for whatever the *next* capability keyed off `device.walletAddress` turns out to be (XMTP identity, email registration already trust it today); treats the symptom instead of the cause ADR-0017 already flagged and deferred |
| Do nothing; keep as a tracked follow-up issue, ship `make release` anyway (rejected) | No work required before release | Ships a known, concretely-demonstrated key-substitution vector to production; the whole point of encrypting inbox messages via `agents.publicKey` is defeated for any address an attacker targets before the legitimate owner ever calls `wallet publish-key` |

## Decision

`POST /devices` (`devices.register`) additionally requires a `signature` input: the
caller signs a canonical message `taskmarket:device-register:<walletAddress>` (added to
`packages/shared/src/lib/authMessages.ts` alongside the existing `build*Message`
helpers) with the private key for the claimed `walletAddress`. The backend verifies it
with `verifySignedAddressOrThrow` (the same helper `wallet.router.ts` and `bids.myBids`
use) before inserting the `devices` row, minting the API token, or writing any
`publicKey`. An invalid or missing signature is a hard `BAD_REQUEST`/`UNAUTHORIZED`
failure — there is no legitimate reason to register a device for an address the caller
cannot prove they control.

Both existing callers already hold a local signer at the point they call
`registerDevice()`:
- `apps/cli/src/commands/init.ts` — `generateKeypair()` produces the private key locally
  before `registerDevice()` is called; the same key already signs the legal-acceptance
  message two lines earlier.
- `apps/cli/src/commands/wallet/import.ts` — the imported key is turned into a local
  `account` via `privateKeyToAccount()` before `registerDevice()` is called; same
  pattern.

Both are updated in the same change to sign the new challenge message and pass
`signature` through `registerDevice()`'s input.

## Consequences

**Positive:**
- Closes the key-substitution vector at its origin: every capability keyed off
  `device.walletAddress` (key decryption, XMTP, email, `agents.publicKey`) now requires
  actual proof of address ownership before a token scoped to that address can exist at
  all.
- Consistent with the one correct "prove you own this address" mechanism the codebase
  already uses elsewhere (ADR-0015, ADR-0017) — no new verification primitive.
- Retroactively resolves ADR-0017's deferred "Neutral / follow-up" item rather than
  leaving it open indefinitely.

**Negative / trade-offs:**
- Breaking change to `POST /devices`'s request shape. Both known callers (the CLI) are
  updated in the same change; there is no telemetry on whether any other caller exists.
- Existing `devices` rows created before this ship were never signature-verified at
  registration time. This ADR does not retroactively re-verify or revoke them — any
  already-issued token remains valid under its original (unauthenticated) issuance.
  Whether that warrants a one-time revocation/re-registration sweep is a separate,
  follow-up question, not part of this decision.

**Neutral / follow-up:**
- Whether pre-existing tokens should be force-revoked is out of scope here and should be
  raised as its own follow-up if the team wants it.

## References

- PR #110 — deep review findings (this decision)
- ADR-0015 — Phase 1's `agents.inbox` scoped self-auth (the precedent this extends)
- ADR-0017 — `bids.myBids` signed self-auth; documented this exact gap and deferred it
  as out of scope, which this ADR now closes
- Issue #183 — Phase 1/2/3 implementation tracker
