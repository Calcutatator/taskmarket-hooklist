# 0077 — A server-derived idempotency key for a public scope is keyed on the platform secret

> **Decision (Y-statement):** In the context of server-derived idempotency keys sharing one global
> namespace with client-supplied ones, facing a sponsored identity mint whose key was a bare
> SHA-256 of a public wallet address — computable offline, claimable for free, and permanently
> fatal to that wallet's onboarding — we decided to derive keys for public scopes by HMAC under
> `PLATFORM_MASTER_KEY` and to stop a failed sponsored write from destroying the registration it
> accompanied, to achieve a key an outsider cannot compute and a request that survives losing its
> optional half, accepting that this makes derived keys unguessable rather than making the
> namespace owned, which remains the more complete fix.

- **Status:** Accepted
- **Date:** 2026-08-09
- **Accepted:** 2026-08-09
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0052
- **Pending Amends / Amended-by:** —

## Context

A security review of this branch found it, and it is worth stating as the reviewer did: no funds
and no other user's data are exposed. What is exposed is availability, permanently, for free, at
any address chosen in advance.

`relayed_intents.idempotency_key` is a single global namespace. ADR-0052 made every relayed write
carry a key, and a key is claimed by whoever presents it first — there is no ownership check,
because for a client-generated random UUID there was nothing to check.

Some keys are not client-generated. `devicesRouter.register` sponsors an ERC-8004 identity mint off
the back of a free device registration, and keys it on
`derivedIdempotencyKey(`${walletAddress}:identity.register`)` so that re-registering a device for a
wallet whose mint is already in flight joins that mint rather than starting a second one. That is
the right behaviour and the reason the key is derived at all.

The derivation was a bare SHA-256, formatted to look like a v4 UUID so it satisfies
`IDEMPOTENCY_KEY_PATTERN`. Every input is public. So:

1. Compute K offline from the victim's address — no interaction with the platform.
2. Present K as `X-Taskmarket-Idempotency-Key` on any relayed write of your own. A
   free-allowance `submissions.submit` costs nothing. The row is written before the chain call, so
   even a send that fails still claims the key.
3. The victim's `POST /api/devices` now loses the unique index. `intentBelongsToCaller` returns
   false on the operation mismatch and the handler throws `idempotency_key_conflict`.

The second defect is what made it permanent rather than annoying. That throw escaped an
un-wrapped `await recordRelayedIntent(...)` **after** the `devices` row had been written, so the
mutation errored and the caller never received `deviceId`/`apiToken`. Every retry recomputed the
same key, hit the same conflict, and orphaned another `devices` row. The free onboarding path for
that wallet was dead for good.

These are two distinct mistakes that happen to compose: a key that should not have been
computable, and a sponsored side-effect allowed to fail its host request.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **HMAC derived keys for public scopes under `PLATFORM_MASTER_KEY`, and make the sponsored mint non-fatal** (chosen) | Removes the attacker's first step entirely: the scope is no longer sufficient to compute the key. No schema change and no migration, so it carries none of the risk of adding one to this branch late. The second half means an ordinary conflict — still reachable by non-adversarial means — costs the mint, never the registration | Makes derived keys unguessable rather than making the namespace owned. A key really presented by two principals is still first-come-first-served; nothing yet says a key belongs to anyone |
| Make the unique index `(idempotency_key, payer)` and refuse a row whose payer differs (rejected for now) | The complete fix. Addresses the actual root cause — an unowned namespace — rather than making one class of key hard to guess, and would hold even if a derived key leaked | Needs a migration, on a branch whose five migrations already need timestamp care against a moving `main`, at the end of its review cycle. It also changes the meaning of a key across every caller, which deserves its own consideration rather than being folded into a security fix |
| Keep the bare digest, and only fix the uncaught throw (rejected) | Smallest change. Registration would survive, and the caller would get their credentials | The key remains claimable, so the sponsored mint is still permanently deniable for any address. It converts a hard failure into a silent one, which is worse than either fixing or leaving it |
| Stop deriving: give the sponsored mint a random key (rejected) | No derivable key at all | Loses the property the derivation exists for. Two device registrations for one wallet would start two mints, which ADR-0052 introduced this key to prevent |

## Decision

1. A server-derived key whose scope is **public** — an address, a task id, anything an outsider can
   name — is derived with `sponsoredIdempotencyKey`, an HMAC-SHA256 under `PLATFORM_MASTER_KEY`,
   formatted as a v4-shaped UUID exactly as before. `devicesRouter.register` uses it.
2. `derivedIdempotencyKey` stays, unchanged, for scopes that are **already unguessable** because
   they are seeded by a caller's own random key — `claims.claim`, the submission and artifact ids.
   The digest inherits that unguessability and there is nothing for a secret to add. Its
   documentation now says which of the two to reach for.
3. A failure to record the sponsored identity-mint intent no longer fails the device registration.
   The device row and its credentials are what the caller asked for; the mint is an extra the
   platform starts off the back of it. The failure is logged.

**What this deliberately does not do.** It does not make the namespace owned. A
`(idempotency_key, payer)` uniqueness rule is the more complete fix and is recorded here as the
follow-up, deliberately deferred rather than forgotten — it needs a migration, and this branch is
past the point where adding one is cheap.

## Consequences

**Positive:**

- The offline computation the attack begins with is no longer possible. Without the platform
  secret there is no way to arrive at another wallet's sponsored key.
- Onboarding cannot be permanently denied by a key conflict from any source, adversarial or not,
  because the registration no longer depends on the mint succeeding.
- The two derivation helpers now state which scopes each is for, so the next server-derived key
  has a rule to follow rather than a precedent to copy.

**Negative / trade-offs:**

- **Existing derived keys change value.** A sponsored mint recorded under the old digest and still
  in flight at deploy is no longer found by the new key, so a device re-registration for that
  wallet in that window could start a second mint. The window is one deploy against an in-flight
  mint on the free path, and the completion handler binds to the wallet's existing agents row
  either way, but it is a real behaviour change rather than a pure hardening.
- Rotating `PLATFORM_MASTER_KEY` now invalidates the derivation, with the same consequence as
  above. The key was already load-bearing for encryption; this adds a second reason not to rotate
  it casually.
- The namespace remains unowned, so this is one class of key made safe rather than the class of
  problem closed.

**Neutral / follow-up:**

- The `(idempotency_key, payer)` index is the successor to this decision and should amend it.
- `apps/web` mints its keys with `crypto.randomUUID()` and was confirmed unaffected; the weakness
  was server-side only.

## References

- [ADR-0045 — relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0052 — every relayed write carries a client-generated idempotency key](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)
- [ADR-0061 — a reused idempotency key with different arguments is refused](0061-a-reused-idempotency-key-with-different-arguments-is-refused.md)
- `apps/backend/src/services/relayed-intents.ts` — `sponsoredIdempotencyKey`, `derivedIdempotencyKey`.
- `apps/backend/src/routers/devices.router.ts` — the sponsored mint.
