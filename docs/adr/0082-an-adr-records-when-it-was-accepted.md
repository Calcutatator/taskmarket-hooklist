# 0082 — An ADR records when it was accepted, separately from when it was written

> **Decision (Y-statement):** In the context of a 76-ADR corpus where `Date:` means
> last-meaningfully-updated, facing the fact that an ADR accepted later than it was drafted loses
> its acceptance date entirely, we decided to add a required `**Accepted:** YYYY-MM-DD` header
> field to every acceptance-bearing ADR and backfill it from git history, to achieve a corpus
> where the decision lifecycle is readable from the records themselves rather than only from
> commit archaeology, accepting that the backfilled dates are derived rather than observed and
> that one more required field is one more thing a drafting agent can get wrong.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Accepted:** 2026-08-11
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amended by ADR-0083

## Context

The ADR header carries one temporal field, `Date:`, documented as when the ADR was last
meaningfully written. `Status:` is a lifecycle — `Proposed → Accepted → Superseded/Deprecated` —
and **nothing records when a transition happened.** For the common case where an ADR is drafted,
reviewed, and accepted days later, the acceptance date exists nowhere in the record.

The gap is not theoretical, and its most likely failure mode is an agent quietly closing it. Faced
with accepting an ADR days after it was drafted, the obvious move is to add an `Accepted:` line to
that one header — the reasoning is right, and the schema offers nowhere else to put the fact. Our
own tooling would not catch it: `parseDocIndexEntry` and the linter read only the header keys they
know and silently ignore the rest, so an unrecognized field produces no lint error, no bad index
entry, and no signal of any kind. One record out of 76 would carry an invented field that no tool
reads, looking authoritative to the next person or agent who opens it.

Two distinct problems, and this ADR addresses the first:

1. **The schema has no place for the acceptance date.** Shared by every ADR here.
2. **An unknown header key is silently tolerated.** Also real, also worth fixing, and deliberately
   *not* in scope here — it is a change to how the linter treats the whole header rather than a
   change to the schema, and bundling them would make this ADR two decisions in one document.

Measured against this repo's corpus at the time of writing: 76 ADRs, of which 31 show a genuine
`Proposed → Accepted` transition in git history, 44 were accepted in the same commit that
introduced them, and 1 is still `Proposed`.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **`Accepted:` header field, required when the status says the ADR was accepted** | The fact lives in the record; mechanically checkable; readable without git | One more required field; historical values must be derived, not observed |
| Leave it in git history (rejected) | Zero change; git already has it | Only recoverable by archaeology, which dates the *commit*, not the decision — and for a bulk-imported corpus dates the import. Unreadable to any reader of the record itself |
| Redefine `Date:` to mean the acceptance date (rejected) | No new field | Silently changes the meaning of 76 existing values, destroying the authored-on date to gain the accepted-on one. Trades one missing fact for a different missing fact |
| A general `transitions:` log covering every status change (rejected *for now*) | Solves `Superseded`/`Deprecated`/`Rejected` dates too; extensible | The header is a flat list of `- **Key:** value` lines with no nested-structure convention; introducing one for a fact only needed at one transition today is a larger change than the problem justifies. Revisit if a second transition date is ever needed |

## Decision

Add `- **Accepted:** YYYY-MM-DD` to the ADR header, immediately after `Date:`.

**Required** when `Status` is `Accepted`, `Superseded`, or `Deprecated`. Superseded and Deprecated
are included deliberately: an ADR reaches either only by having been accepted first, so dropping
the requirement on the way out would discard the date exactly when the record becomes historical.

**Forbidden** when `Status` is `Proposed`, `Rejected`, or `Withdrawn` — those were never accepted.
This direction blocks too, and it matters more than it looks: an acceptance date written onto a
still-`Proposed` ADR is an assertion that an approval happened. That is the same self-approval
`.claude/commands/adr.md` already forbids for `Status`, in a field that looks like bookkeeping
rather than a decision, which makes it likelier to slip through unnoticed.

Both directions are blocking errors in `adr-lint.ts`. Ordering against `Date:` is warn-only,
because `Date` means last-meaningfully-updated: an ADR whose `Date` was legitimately bumped by a
later revision has `Accepted < Date` without anything being wrong.

The one ADR that tripped this warning on the first run (0018) turned out **not** to be that case:
it was committed on 2026-07-20 carrying `Date: 2026-07-21`, a date one day in the future at the
time of writing, and never corrected since. Its `Date` is now 2026-07-20, matching the commit that
introduced it. A warn-only check earning its place by finding a real error on its first run is
worth recording — the value the corpus had been carrying for three weeks was simply wrong, and
nothing before this had any reason to compare the two dates.

The acceptance date is also validated as a **real calendar date**, not merely a well-shaped one:
`2026-02-30` and `2026-13-01` match `YYYY-MM-DD` but name days that never existed. This matters
here more than for a hand-typed field, because the historical values were machine-derived in bulk,
where an arithmetic slip produces impossible dates rather than merely wrong ones.

Field lookup is scoped to the **header block** — everything above the first `##` heading — so a
list item in the body cannot satisfy a header field. Anchoring to the list-item shape alone is not
enough, since the body is made of list items too. A second `Accepted:` line in the header is a
blocking error rather than silently resolving to the first: two acceptance dates means the record
states two different facts and no reader can tell which is operative.

**Backfill** is derived from git by `scripts/backfill-adr-accepted-date.mjs`, kept in the repo so
the derivation stays auditable rather than being a run-and-discard script. Per ADR: the commit that
changed `Status` to an acceptance-bearing value (31 records), or the first commit carrying the file
when it was already accepted (44 records). There is deliberately **no fallback to `Date:`** — using
it would manufacture an acceptance date out of an unrelated fact, which is the exact failure this
field exists to prevent. Every acceptance-bearing ADR resolved; none needed a hand-supplied date.

The script refuses to run in a shallow clone. Every date it produces is read out of history, so a
truncated history does not fail — it answers with the oldest commit it happens to have, dating
every ADR to the clone, and the output looks exactly as confident as a correct run. That is the
same class of defect as a check that reports "0 errors" while examining nothing.

## Consequences

**Positive:**

- Proposal-to-acceptance latency becomes measurable from the corpus. 31 ADRs here have a real gap
  between drafting and acceptance that was previously invisible.
- The self-approval guardrail gains a second mechanical enforcement point. Previously only `Status`
  was checked; an agent could not fake acceptance in `Status` but there was no acceptance date to
  fake either. Now there is one, and writing it fails the build.
- Anything reasoning about time-in-status — staleness of a long-`Proposed` ADR, audit cadence —
  now has a date to reason from.

**Negative / trade-offs:**

- **The 75 backfilled dates are derived, not observed.** For the 44 born-accepted records the
  commit date is an upper bound on the acceptance rather than the acceptance itself, and a
  squash-merged acceptance dates to the merge rather than to the decision. Accurate to about a
  day, and that limit is inherent — the information was never recorded at the time.
- One more required field is one more thing a drafting agent can get wrong. Mitigated by the
  linter blocking both directions and by `.claude/commands/adr.md` naming the field explicitly.
- Accepting an ADR is now a two-field edit (`Status` and `Accepted:`) rather than one. The linter
  catches a forgotten second half.

**Neutral / follow-up:**

- The unknown-header-key gap (Context, problem 2) remains open and wants its own ADR: the linter
  should report a header key it does not recognize, rather than ignoring it, so the next invented
  field is caught at the moment of invention.
- A general `transitions:` log stays a live option if a second transition date is ever needed.

## References

- `scripts/backfill-adr-accepted-date.mjs` — the derivation, including the cohort split and the
  deliberate absence of a `Date:` fallback.
- `packages/adr/lib.ts` — `checkAcceptedField`, `ACCEPTANCE_BEARING_STATUSES`, `ACCEPTED_RE`.
- `docs/adr/README.md` — the header field list and the blocking/warn-only check inventory.
- `.claude/commands/adr.md` — the drafting guardrail extended to this field.
