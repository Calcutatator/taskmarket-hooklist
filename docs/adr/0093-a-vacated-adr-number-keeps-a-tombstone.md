# 0093 — A vacated ADR number keeps a tombstone

> **Decision (Y-statement):** In the context of a corpus with four numbers missing from its
> sequence, facing a numbering warning that fires forever on a state nobody can fix and old
> references that resolve to nothing, we decided that a number vacated by renumbering keeps a
> `Withdrawn` tombstone record naming where the decision went, and that structural checks assuming a
> decision exists become status-aware, to achieve a contiguous sequence whose remaining warnings all
> correspond to live reservations, accepting one small file per vacancy and a status that now means
> two things.

- **Status:** Proposed
- **Date:** 2026-08-18
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (pending — needs a technical ack)
- **Deciders:** (pending — Beau)
- **Supersedes / Superseded-by:** —

## Context

`adr-lint` reports four numbers missing from the sequence: 0012, 0013, 0043 and 0044. Its message
hedges — *"fine if a PR reserving it hasn't merged yet, otherwise confirm it wasn't silently
skipped"* — because it cannot tell those cases apart. Tracing each one shows the corpus contains
both, and they need opposite treatment.

**0012 and 0013 are vacated.** Commit `8d82cae4` states the cause in its subject: *Renumber
ADR-0011/0012/0013 to 0014/0015/0016 to avoid collision with main*. A branch allocated
`highest + 1`, `main` had already taken those numbers, and the branch renamed its own records. The
decisions live at ADR-0015 and ADR-0016; the original numbers are permanently unused.

**0043 and 0044 are reserved**, by open PRs #413 and #409. Those numbers will be filled when those
branches merge, and nothing should be done about them.

For the vacated pair, neither available response is acceptable:

- **Backfill the number** — a decision written today would sit between two from July, and the
  numbering would imply an order that never happened.
- **Renumber to close the gap** — every `Implements: ADR-NNNN` back-pointer in code, every commit
  message and PR title naming a number, would have to move with it. This corpus has already paid
  that twice, and it left `docs/rfc/0007` still reserving the range 0039 through 0043 by number, a
  reference that resolves to nothing and which no check covers.

So the warning is permanent and unactionable, which is how a whole warning stream stops being read.
This repo already found that pattern twice — the self-ack nudge and this same numbering check — and
the fix both times was to give the check a declared notion of what is expected.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **A tombstone record at the vacated number** | Sequence is contiguous, so the check needs no exception logic; an old reference lands on an explanation; bounded — one file, written once | One file per vacancy; `Withdrawn` now covers both a pulled proposal and an unused number |
| A config allowlist of expected gaps (rejected) | No new records | Silences without recording why, grows without bound, and is invisible to the person actually asking — who is reading `docs/adr/`, not the linter's config |
| Delete the numbering check (rejected) | No warning at all | Loses the only signal that would show a number claimed by a branch that vanished, and leaves old references still resolving to nothing |
| Renumber to close the gaps (rejected) | Tidy sequence | Breaks code back-pointers and history; already done twice here, and produced the dangling reference above |

## Decision

**A number vacated by renumbering keeps a record at that number**, with `Status: Withdrawn`, an
`Embodiment` of `Inactive`, and a body stating that no decision was made here and where the decision
went. ADR-0012 and ADR-0013 are added on that basis.

**Structural checks that presuppose a decision become status-aware.** `Withdrawn` records are exempt
from the required-sections check, the Y-statement check and the considered-options minimum, via
`statesADecision()` in `packages/adr/lib.ts`. A tombstone forced to invent a Y-statement to satisfy
a linter would be a record that lies in order to pass, which is worse than the gap it replaces.
Every other check still applies: filename format, valid status, `Date`, header closure, the
acceptance-date rules, and dangling-reference detection.

`Withdrawn` is reused rather than adding a `Vacated` status. The enum is already six values and a
seventh has to be learned by every reader and consumer; the tombstone's title and body carry the
distinction unambiguously. If a machine ever needs to tell the two apart, that is the moment to add
the value.

**Nothing is done about 0043 and 0044.** They are reserved by open PRs. After this change the
numbering check reports exactly those two, so its output becomes a list of live reservations rather
than an unactionable mix.

That gives a number three possible fates, and each has one correct response:

| State | Numbering check | Response |
|---|---|---|
| Held by an open PR | Warns | None. The gap closes when that PR merges |
| Merged | Silent | None |
| **Claimed by a PR that was closed unmerged** | **Warns forever** | **Tombstone naming the closed PR** |

The third is the case that turns a warning permanent, and it is invisible without checking whether
the holding PR is still open. Closing a PR that drafted an ADR therefore leaves a number vacated,
exactly as a renumbering does, and the same remedy applies — a tombstone recording that the number
was claimed by a PR that did not land, and that no decision was made.

This makes the warning a work queue rather than noise: every entry is either waiting on a merge or
waiting on a tombstone, and telling which takes one lookup.

## Consequences

**Positive:**

- The numbering warning is now actionable in every case it fires: each remaining entry names a
  number an open PR is holding.
- A commit, PR title or comment referencing ADR-0012 resolves to a record explaining where the
  decision went, instead of to absence — which is indistinguishable from "never existed" or "you are
  looking in the wrong place".
- No renumbering, so no back-pointer, commit or PR reference changes.

**Negative / trade-offs:**

- `Withdrawn` now means two things: a proposal that was pulled, and a number that was never used.
  The records read unambiguously, but a consumer filtering on status alone cannot separate them.
- One file per vacancy. Cheap here at two, and it is a per-vacancy cost that never goes away.
- Exempting `Withdrawn` from the structural checks means a genuinely withdrawn *proposal* also
  escapes them. That is arguably correct — a pulled proposal need not carry a decision — but it is
  a wider exemption than the tombstone case strictly needs.

**Neutral / follow-up:**

- `docs/rfc/0007` still reserves the range 0039 through 0043 by number. Now that 0043 is a live reservation
  held by PR #413 rather than a dead number, that line will resolve once that PR merges. RFC bodies
  are still not checked for dangling record references.
- Nothing here prevents the next collision. `highest + 1` is a read of local state with no
  reservation, and two branches open at once can still take the same number.
- The check cannot yet distinguish a number held by an open PR from one whose PR was closed, so the
  work queue above is resolved by hand. Resolving open PRs to classify each gap automatically is the
  obvious next step and is not built here.

## References

- `docs/adr/0015-phase1-inbox-scoped-self-auth-not-general-framework.md`,
  `docs/adr/0016-submission-visibility-independent-axis-default-public.md` — where the vacated
  numbers' decisions live.
- `packages/adr/lib.ts` — `statesADecision`, `DECISIONLESS_STATUSES`.
- Commit `8d82cae4` — the renumbering that vacated 0012 and 0013.
