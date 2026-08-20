# 0098 — Submissions and tasks carry short public reference codes, distinct from their ids

> **Decision (Y-statement):** In the context of submissions and tasks whose only identifiers are a
> 36-character UUID-shaped digest and a chain-derived id that nobody can quote, facing users who
> need to name a specific piece of work in conversation and search for it later, we decided to mint
> and store a short prefixed Crockford base32 reference code on each and treat it as the public name
> while the existing ids stay the primary keys, to achieve identifiers that can be read aloud, typed
> from a screenshot and searched for, accepting two new columns, a backfill across existing rows and
> a second identifier per entity to keep consistent.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Accepted:** 2026-08-17
- **Embodiment:** Verified
- **Last audited:** 2026-08-17
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — reviewed at acceptance; no separate independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

`submissions.id` is produced by `derivedIdempotencyKey`, which SHA-256 hashes a scope string and
reshapes the digest to satisfy the idempotency key pattern — a value like
`3f9c1a04-77b2-4e15-9d3a-6b8e0c15f2aa`. It is a good primary key and a good idempotency key. It is
not a name.

Thirty-six characters of hex and dashes cannot be read over a call, cannot be typed from a screenshot
without transcription errors, and will not be quoted in a Discord message. The originating request —
"add codes for each submission so that people can search for submissions they have" — is asking for
something the primary key structurally cannot be, no matter how it is displayed.

Tasks are a weaker version of the same problem rather than an exception to it. `tasks.id` is
chain-derived and already appears in URLs, so it is at least stable and citable — but it is no more
sayable than a submission digest, and a task is the thing people most often want to point someone at.
Adding the scheme to both at once costs one more column and one more prefix; adding it to tasks later
means a second migration, a second backfill, and a period where two sibling entities are named by
different conventions.

Truncating an existing id does not solve it. The first eight characters of a digest are still hex,
still ambiguous when read aloud, and carry no uniqueness guarantee: nothing prevents two rows from
sharing a prefix, and the collision would be discovered by a user opening the wrong piece of work.

Deriving a code from the id at read time is worse than it looks. The value users write down would be
a function of an algorithm rather than a stored fact, so any future change to that algorithm silently
invalidates every code already quoted in a message, a screenshot, or a saved link. A code that a
person is expected to keep has to be a stored fact.

The alphabet matters more than it seems. Standard base32 produces codes where `0`/`O` and `1`/`I`/`l`
are indistinguishable in most fonts, which is exactly the failure mode of a code transcribed from a
screen. It also occasionally produces recognizable profanity, which will eventually appear next to
someone's work.

One wrinkle is specific to tasks. A task row is written either by the intent completion that observed
the receipt (ADR-0055) or by a later reconciliation pass over the same chain event (ADR-0029). Both
paths must produce exactly one code for one task, and a reconciliation insert cannot recover
off-chain-only creation inputs — but a randomly minted code needs no recovery, only a single owner.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Mint and store a short prefixed Crockford base32 code on both submissions and tasks, keeping the existing ids as primary keys | Sayable, typeable, unambiguous by construction; permanently stable because it is stored; uniqueness enforced by the database; one convention across both entities from the start | A second identifier per entity to keep consistent; two columns, two unique indexes and a backfill |
| Submissions only, tasks later (rejected) | Smaller first change; matches the literal wording of the original request | A second migration and backfill for the same mechanism; an interval where sibling entities are named by different conventions, which is the state that makes a convention stop being followed |
| Display a truncated prefix of the existing id (rejected) | Zero schema change; nothing to backfill | Still hex and still ambiguous aloud; no uniqueness guarantee, so two rows can share a prefix and a user opens the wrong one |
| Derive the code from the id at read time (rejected) | No column, no backfill, no minting path | Every code a user has written down is invalidated by any change to the derivation; a quotable identifier cannot be a function that might change |
| Sequential numbering, e.g. task 41 submission 3 (rejected) | Very short and genuinely memorable; naturally scoped | Only meaningful alongside its parent, so it is not independently searchable; needs a counter that concurrent writes contend on; leaks volume per parent |
| Reuse the on-chain deliverable hash (rejected) | Already exists; content-addressed and verifiable | Even longer than the id; nullable in the current schema; identifies content rather than the event, so two identical deliverables collide |
| One shared prefix for every entity (rejected) | One pattern to parse | A code out of context no longer says what it names, so search cannot route an exact-identifier lookup without trying every table |

## Decision

Every submission and every task carries a `reference_code`: an entity prefix followed by eight
characters drawn from Crockford's base32 alphabet.

- Submissions: `SUB-`, e.g. `SUB-7K2QA9XF`
- Tasks: `TSK-`, e.g. `TSK-4M0BXQ2E`

The code is generated randomly at row-write time, stored in its own column, and protected by a unique
index per table. It is never reused, never regenerated, and never derived from the row's contents or
id. For tasks, minting belongs to the insert itself, so whichever path writes the row first — intent
completion or reconciliation — mints the one code, and the other path finds the row already present.

`submissions.id` and `tasks.id` remain the primary keys. The reference code is the public name: it is
what the UI displays, what search accepts, and what appears in shareable URLs.

Lookup is case-insensitive and tolerant of a missing prefix and of Crockford's documented character
substitutions, but storage and display are always the single canonical uppercase form. A code
presented without its prefix is resolved against both entities, and an ambiguous match is reported
rather than guessed.

## Consequences

**Positive:**

- A submission or a task can be named in conversation, read over a call, and typed from a
  screenshot — which is what was asked for, and what the primary keys cannot do.
- Codes are stable for the lifetime of the row, so a code quoted in a message a year ago still
  resolves.
- Uniqueness is a database guarantee rather than a probabilistic argument about digest prefixes.
- Search gains an exact-match path that short-circuits ahead of ranked full-text matching, and the
  prefix tells it which table to look in.
- One naming convention covers both entities from the first release, so there is never a period where
  a task and its submissions are identified by different kinds of thing.
- The primary keys stop leaking into user-facing surfaces, so the idempotency derivation stays free to
  change.

**Negative / trade-offs:**

- Two identifiers now exist per row, and every surface has to be clear about which it is showing. A UI
  that shows both is worse than one that shows neither.
- Existing submissions and tasks both need backfilling, each a two-deploy sequence before its column
  can be made `NOT NULL` — the same shape as ADR-0008. This is twice the migration work of the
  submissions-only option.
- Minting requires a collision retry loop. At 32^8 the probability is negligible, but the unique index
  means a collision is an error rather than silent corruption, so the retry has to exist.
- A short random code is guessable in a way a 36-character digest is not. It is an identifier, not a
  capability: authorization stays with the existing visibility rules and must not come to depend on
  the code being secret.
- Prefixless lookup can be ambiguous across two tables, which needs an explicit answer rather than a
  silent preference for one entity.

**Neutral / follow-up:**

- Agents and task drops are deliberately not included. The scheme extends to them with a further
  prefix if a need appears; neither is something users currently ask to quote.
- Crockford's alphabet is chosen for its exclusions rather than its density; a shorter code would need
  a different argument about collision probability.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- Spec: `docs/specs/reference-codes.md`
- Search integration: ADR-0099
- Two-deploy migration precedent: ADR-0008
- Task-row write paths that must mint exactly one code: ADR-0055, ADR-0029
- Current identifier derivation: `apps/backend/src/services/relayed-intents.ts`
  (`derivedIdempotencyKey`)
