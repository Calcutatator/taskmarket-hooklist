# 0070 — A reason that asserts a fact carries it, rather than leaving a reader to guess

> **Decision (Y-statement):** In the context of the `ApiErrorEnvelope` a client branches on,
> facing an `idempotency_key_reused` answer whose `intentStatus` was optional even though the
> reason itself asserts an intent exists, we decided to make the envelope a discriminated union
> that requires the status on exactly that reason — so an envelope without it fails to compile at
> the producer and fails to parse at the reader — to achieve a boundary where the guess
> `isInFlightApiError` used to make is not representable, accepting one more shape in the shared
> schema and that an envelope from a backend predating this reads as no information rather than
> as a terminal outcome.

- **Status:** Accepted
- **Date:** 2026-08-06
- **Accepted:** 2026-08-06
- **Embodiment:** Verified
- **Last audited:** 2026-08-06
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0058
- **Pending Amends / Amended-by:** —

## Context

ADR-0058 built the `ApiErrorEnvelope` and wrote its rule down in one sentence: "Every field beyond
`reason` is optional because not every reason has one." That is true of nearly every field. It was
not true of one pair.

`reason: 'idempotency_key_reused'` does not merely describe a failure. It asserts a fact about the
world: an intent under this idempotency key exists, and this request neither charged the caller
nor submitted anything a second time. An intent that exists has a status. There is no state of the
system in which that reason is correct and `intentStatus` is unknowable — and where the row really
has gone (`reserveRelayedWrite`'s missing-row branch) the code already refuses to send this reason
at all, using `idempotency_check_unavailable` instead, with a nine-line comment explaining exactly
why a statusless reused-key envelope would mislead.

So the field was optional in the schema and mandatory in fact, and `isInFlightApiError` was left
holding the difference. Its answer for this reason is `status ∈ {reserved, recorded, broadcast}`,
which for an absent status silently returns `false` — "terminal". That is a guess, and it is the
guess in the more expensive direction: a caller told a live write is settled generates a fresh key
and pays for the same operation twice. The comment on that function documented the default rather
than removing the need for it.

This is the third time this repository has hit the same shape:

- `VERDICT_MAP` read with `?? 0`, where an unmapped verdict fell through to `approve` — a payout.
  It became a compile error over a total `Record<Verdict, number>` plus an explicit throw.
- The CLI's failure envelope, where `pending` absent had to be documented as "unknown, never
  safe" precisely because absence and `false` were indistinguishable on the wire.
- This.

Each began as a reader choosing what to do about a state that should not have been representable,
and each was fixed by making the state unrepresentable instead. Worth naming once as a rule rather
than rediscovering a fourth time.

Two of the three producers also wrote `existing.status as ApiErrorEnvelope['intentStatus']`.
`relayed_intents.status` is a `text` column — its TypeScript type is `string`, the five values are
enforced only by a database CHECK constraint, and `as` verifies nothing. The cast is the same
class of mistake one level down: an unchecked claim standing in for a check.

## Considered options

| Option                                                                     | Pros                                                                                                                                                                                            | Cons                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Discriminated union on `reason`, required `intentStatus` on the one reason (selected) | Enforced twice, at both ends: omitting it does not compile at a producer and does not parse at a reader. The inferred type carries the rule, so no comment has to. Every other reason is untouched | One more member in the shared schema; a `reason` narrowed by hand no longer type-checks against the whole union without narrowing |
| `superRefine` on the existing flat object                                  | Smallest diff; one schema shape                                                                                                                                                                 | Runtime only — the inferred type keeps `intentStatus` optional, so a producer omitting it still compiles and only fails when thrown |
| Keep the field optional, keep the default in `isInFlightApiError`, document it harder | No code change; no compatibility question at all                                                                                                                                                | Leaves a guess at the exact boundary where the guess costs a double payment, and leaves it as prose that the next reader may not read |
| Treat an absent status as in-flight instead of terminal                    | Fails in the cheaper direction                                                                                                                                                                  | Still a guess, and it makes a settled failure show as "still confirming" indefinitely — the false positive ADR-0049 named        |

## Decision

A reason code that asserts a fact carries that fact as a required field, enforced by the schema at
the boundary where a reader would otherwise have to guess.

Concretely: `ApiErrorEnvelopeSchema` becomes a `z.discriminatedUnion('reason', …)` with two
members — `idempotency_key_reused` with a required `intentStatus`, and every other reason with an
optional one. `apiError` in the backend takes `ApiErrorEnvelope & { message, code? }` rather than
restating the fields, so the union's rule applies at every throw site. `isInFlightApiError` loses
its unknown-status case, which is now unreachable. The `as` casts on `relayed_intents.status` are
replaced by `intentStatusOf`, which parses.

`apiErrorEnvelopeOf` is unchanged in behaviour and deliberately so: what it cannot parse it still
returns as `null`, so a client on an older shared package reads an unrecognised shape as no
information rather than as something to compare against.

## Consequences

**Positive:**

- The double-payment guess is gone rather than defaulted: there is no envelope shape that reaches
  `isInFlightApiError` with this reason and no status.
- Both ends enforce it. A backend producer that forgets the status is a type error; a wire body
  that lacks it parses to `null`.
- `relayed_intents.status` is parsed rather than asserted on its way onto an envelope, so a value
  outside the five raises at the producer instead of travelling to a client unchallenged.

**Negative / trade-offs:**

- The shared type is a union, so code holding an `ApiErrorEnvelope` with an unnarrowed `reason`
  can no longer be passed where a specific member is expected without narrowing first. One test
  needed exactly that change.
- An envelope produced by a backend older than this — reused-key with no status — now parses to
  `null` in a new client. The web app falls back to its ADR-0058-era prose markers in that case,
  which read it as pending; the CLI reports no envelope, which its own documentation already says
  to treat as unknown rather than safe. Both are acceptable; neither is silently wrong.

**Neutral / follow-up:**

- The rule generalises but is applied here only. If another reason grows a fact it asserts —
  `payment_already_spent` naming the intent that consumed the payment, for instance — it belongs
  in the same union rather than in a reader's default.

## References

- ADR-0058 — Every API error carries a machine-readable reason (this refines its "every field
  beyond `reason` is optional" rule for the one reason where it was never true).
- ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface
  (the false positive this protects: a settled failure shown as still confirming, and its
  opposite).
- ADR-0061, ADR-0067, ADR-0068 — the reused-key semantics whose statuses this envelope reports.
- `packages/shared/src/schemas/api-error.schemas.ts`, `apps/backend/src/lib/api-error.ts`.
