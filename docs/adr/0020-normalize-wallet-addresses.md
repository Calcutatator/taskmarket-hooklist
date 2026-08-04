# 0020 — Normalizing wallet addresses

> **Decision (Y-statement):** In the context of storing and signing over wallet addresses
> across the shared package, backend, and CLI, facing duplicate database rows and inconsistent
> behavior caused by the same real address being handled under different EIP-55 checksum
> casing, we decided to normalize every address to lowercase — both in every signed-message
> builder in `packages/shared` (so client and server always construct identical message text
> regardless of the caller's casing) and at every write site touching `agents`/`devices` — to
> achieve one consistent canonical form throughout the system, accepting that this is a breaking
> change for any already-deployed CLI install until it upgrades.

- **Status:** Accepted
- **Date:** 2026-07-21
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** beauwilliams
- **Reviewers:** beauwilliams — self-attested; no independent reviewer recorded
- **Deciders:** beauwilliams
- **Supersedes / Superseded-by:** —

## Context

`agents.address` is a case-sensitive `text` primary key. `devices.wallet_address` is a plain
`text` column keyed off the same real-world addresses. Reads against these columns were
migrated, router by router, to a case-insensitive comparison via the `lowerAddressEq()` helper
(`apps/backend/src/lib/agents.ts`) — this is now used broadly (`xmtp.router.ts`,
`identity.router.ts`, `proofs.router.ts`, `bids.router.ts`, `emails.router.ts`,
`wallet.router.ts`, `tasks.router.ts`, `agents.router.ts`, `devices.router.ts`).

Writes were never normalized the same way, and neither were the signed-message builders in
`packages/shared/src/lib/authMessages.ts` — most of them interpolated the raw address string
into the message a client signs, verbatim. `buildSelectWorkerMessage` was the one exception,
already lowercasing its address parameter; the rest (`buildInboxSelfAuthMessage`,
`buildMyBidsMessage`, `buildSetWithdrawalAddressMessage`, `buildWithdrawDreamsMessage`,
`buildDeviceRegisterMessage`) did not.

This was found while investigating a `devices.key` "Device not found" error traced to a
database migration gap (tracked separately in issue #169 — that issue is scoped to the
`hopper` → `zephyr` data backfill and is unrelated to this ADR). While root-causing that
incident, duplicate `agents` rows for the same real address under different casing turned up,
including ones being created live on the day of the investigation — confirming this wasn't just
historical data debt but an active, ongoing gap in how addresses are handled.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Normalize to lowercase everywhere — shared message builders, Zod validation, and every DB write site (this ADR) | One consistent canonical form end to end; matches the read-side convention already in place (`lowerAddressEq`); checksum casing is a display-only convention anyway (EIP-55 is for typo detection, not part of the address's identity) — recoverable via `getAddress()` at render time; fixing the shared builder functions means client and server change together via a single `@taskmarket/shared` bump, no per-call-site coordination needed | Breaking change for any already-deployed CLI install — an un-upgraded client still signs messages against the old (un-normalized) text, so its requests will fail signature verification against an upgraded server until it updates; loses checksum casing as stored (must re-derive for display) |
| Normalize only at the point of DB persistence, leave signed-message construction using the caller's original casing (rejected) | Fully backward compatible with every already-deployed CLI version, no client changes needed | Was the initial approach considered here, but explicitly rejected in favor of the simpler end-to-end fix — the project is about to ship a release, so a coordinated client+server breaking change was accepted as the cost of a single clean fix rather than carrying two casing conventions indefinitely |
| Leave writes and message-building case-sensitive, keep expanding `lowerAddressEq` reads (status quo, rejected) | No migration or client changes needed | Does not fix the root cause — new duplicate rows keep being created any time a caller's casing differs from what's already stored |
| Case-insensitive unique index/constraint instead of normalizing storage (rejected) | Prevents new duplicates without changing existing stored casing | Doesn't resolve which row wins when a client re-registers under different casing; a case-insensitive constraint on a case-sensitive column requires an expression index and doesn't fix the `ON CONFLICT` target used by existing `onConflictDoUpdate` calls, which target the literal column |

## Decision

Accepted, as a coordinated client + server + shared-package change shipping together in the
upcoming release:

1. **Signed-message builders** (`packages/shared/src/lib/authMessages.ts`) now lowercase every
   address parameter before interpolating it into the message text — `buildInboxSelfAuthMessage`,
   `buildMyBidsMessage`, `buildSetWithdrawalAddressMessage`, `buildWithdrawDreamsMessage`,
   `buildDeviceRegisterMessage`, matching the pattern `buildSelectWorkerMessage` already used.
   Since both the CLI and the backend import these same shared functions, this is a single
   change that keeps both sides in sync automatically — no separate client-side message
   construction to track down.
2. **Canonical Zod address schema.** Introduced `EthAddressSchema` in
   `packages/shared/src/schemas/common.schemas.ts` (shape validation only, no transform — see
   `normalizeAddress` below for why), and pointed the three previously-duplicated regexes
   (`wallet.schemas.ts`, `legal.schemas.ts`, `xmtp.schemas.ts`) at it instead of each redefining
   their own.
3. **`normalizeAddress()` helper**, applied at the point of writing to `agents`/`devices`.
   Audited every write site touching those tables:
   - Normalized: `devices.router.ts`, `xmtp.router.ts`, `emails.router.ts`, `wallet.router.ts`
     (both `agents.address` and `agents.withdrawal_address` — see below), `agents.router.ts`,
     `services/indexer.ts`.
   - Already safe, no change needed: `identity.router.ts` (already lowercases `payer` before
     any use), `acceptance.router.ts` (pure counter update against an existing row via a
     case-insensitive `WHERE`, never creates a new row), `services/settlement-recorder.ts`
     (already calls `.toLowerCase()` on the worker address before using it as a map key).
   - **`agents.withdrawal_address`**: unlike `agents.address` and `devices.wallet_address`,
     this column has no unique constraint — it's a payout destination *value*, not an identity
     *key*, so inconsistent casing here was never a duplicate-row risk (every comparison
     against it already lowercases both sides at read time, and it's passed to the on-chain
     transfer call where casing doesn't matter). It was still worth normalizing for
     consistency with the rest of this change; caught in review after the initial PR only
     normalized the agent's own `address` column and missed this one.
   - **`buildWithdrawDreamsMessage`'s `destination` parameter**: checked and confirmed out of
     scope — it's never persisted to any table, only used in the (already-normalized) signed
     message and passed straight to the on-chain call.
4. **This is a breaking change, accepted deliberately**: an already-deployed CLI install signs
   messages using its own un-normalized casing; once the server ships message builders that
   normalize before reconstructing the expected message, an old client's signature will no
   longer verify until it upgrades to a `@taskmarket/shared`/CLI version that also normalizes.
   Given the project has an upcoming release and clients are expected to update, this was
   accepted rather than maintaining a compatibility shim for both casing conventions.
5. **Changeset**: the existing unreleased `@lucid-agents/taskmarket` changeset on `main`
   (`task-visibility-cli.md`) is being updated to document this change, since it hasn't shipped
   to production yet.
6. **Not in scope here**: the one-time data migration normalizing *existing* `agents.address` /
   `devices.wallet_address` rows to lowercase, and confirming what's actually deployed to
   production today vs. what's in this repo — both are real follow-up work but are being
   tracked separately so this ADR stays scoped to the casing-normalization decision itself, not
   the data cleanup (see issue #169) or the deploy-verification question.

## Consequences

**Positive:**
- One consistent canonical address form across shared message-signing, validation, and storage.
- Client and server can't drift out of sync on message format, since both call the same shared
  builder functions.
- Eliminates the duplicate-row bug class going forward.

**Negative / trade-offs:**
- Breaking change for any CLI install that doesn't upgrade — will see signature verification
  failures on device registration, withdrawal-address setting, DREAMS withdrawal, inbox
  self-auth, and my-bids self-auth until it updates.

**Neutral / follow-up:**
- The one-time data migration for existing rows, and confirming the currently-deployed backend
  version, are tracked in issue #169 rather than here.
- Smoke tests covering every affected signed flow (`identity`, `wallet`, `withdraw`, `inbox`,
  `bids-inbox`, `pitch`, `token-reward-hook`) should be run before this ships.

## References

- `packages/shared/src/lib/authMessages.ts` — signed-message builders
- `packages/shared/src/schemas/common.schemas.ts` — `EthAddressSchema`, `normalizeAddress()`
- `apps/backend/src/lib/agents.ts` — `lowerAddressEq()`
- `apps/backend/src/routers/devices.router.ts` — `register` mutation
- the `task-visibility-cli.md` CLI changeset (unreleased at the time, since consumed by a release) — updated alongside this
- Issue #169 — the `hopper` → `zephyr` data migration/backfill this was discovered during
  (separate scope from this ADR)
