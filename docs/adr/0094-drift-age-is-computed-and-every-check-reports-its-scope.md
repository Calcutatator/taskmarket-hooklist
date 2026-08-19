# 0094 — Drift age is computed at report time, and every check reports its scope

> **Decision (Y-statement):** In the context of a drift alert that says a record disagrees with its
> evidence but not whether that is new or long-standing, and checks whose zero cannot be told apart
> from a run that examined nothing, facing a CI job that holds a read-only token and a drift gate
> that keeps the default branch clean by construction, we decided to compute each drifted record's
> age from this repository's own history at report time and to have every check emit one scope
> shape, to achieve an answer that needs no write path and results that are self-describing,
> accepting that the age dates the claim rather than the moment drift began.

- **Status:** Accepted
- **Date:** 2026-08-19
- **Accepted:** 2026-08-19
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

**A drift alert has no age.** `adr-audit` reports that a record's stated `Embodiment` disagrees with
the computed value. It cannot say whether the disagreement appeared in the last commit or has stood
for months, and those call for different responses: the first is a regression to fix now, the second
is a claim that has been wrong long enough to doubt the process that produced it. The audit's output
lands in `docs/adr-audit/`, which is gitignored, so there is nothing to compare a run against.

**A check's zero does not say what it examined.** `adr-lint` reports `filesExamined` and a `scope`.
`adr-audit` reports `driftCount`, `graceCount` and `failOnDrift` but no count and no scope, and it
reports `status: "drift" | "clean"` — a private vocabulary no other check here uses. `spec-lint`
emits no machine-readable output at all, only prose. So `"driftCount": 0` is the same statement
whether the audit swept 91 records or matched none.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Compute the age from git at report time; one scope shape across every check** (chosen) | No write path, no permissions, cannot go stale; runs only for records already flagged, so a clean corpus costs nothing | Dates when the stated value was last set, not when drift began; three checks must keep one shape in step |
| Append one line per run to a tracked ledger (rejected) | A real series, including records that started and stopped drifting | The job running these checks declares `contents: read`, so it cannot write at all — and the series it would record is flat, see below |
| Commit the generated report (rejected) | Nothing new to build | A regenerated whole-file table conflicts on nearly every branch that touches `docs/adr/`, in derived output whose only honest resolution is to re-run the tool |
| Leave scope reporting to the checks that already have it (rejected) | Nothing to build | The rule then holds where it was convenient and not where it was not, which is how the gap appeared |

## Decision

**Report a drift age alongside each drift alert**, resolved from this repository's own history of
the record's file, for the records already flagged and only those. A clean corpus performs no
lookups.

The search is `git log -G` over the field's list item, not `git log -S`. `-S` counts occurrences of
a string, and editing a field's *value* leaves that count unchanged — it would skip exactly the
commits being looked for and return the commit that introduced the field, presenting a record's
creation date as the age of its current claim.

It dates the **claim**, not the drift. Drift begins at the later of the claim being set and the
evidence changing, so the interval is an upper bound, and the wording reads "stated value unchanged
since" rather than "drifting for". It fails soft: a shallow clone or an uncommitted record yields no
age, never a withheld finding.

**One scope shape, emitted by every check:**

```json
{ "status": "ok | warn | error | not-run", "filesExamined": 91, "scope": { "source": "tracked-sweep", "base": null } }
```

Each check keeps its own findings alongside these. `status` says what was found; whether that fails
a build is the caller's choice and lives in `blocking`, so drift is a `warn` even when
`--fail-on-drift` turns it into a failing exit. `status` is `not-run` — never `ok` — when nothing
was examined, keyed on the file count rather than on a missing `base`, since a `tracked-sweep`
legitimately has `base: null` while examining the whole corpus. `spec-lint` gains the JSON channel
it did not have, and its prose moves to stderr so stdout is a pure data channel.

**Why no stored history.** `.github/workflows/ci.yml` gives the job that runs these checks
`contents: read`. A ledger step in it cannot write to the repository. Widening the job to
`contents: write` would grant every step in it write access to the repository in exchange for a
reporting convenience, and a ledger step that silently fails to append is worse than none — a gap in
the history reads as an absence of drift rather than an absence of data.

Independently of permissions: `--fail-on-drift` runs in CI and in `.husky/pre-commit`, so drift
blocks the merge and the default branch is drift-free by construction. A per-run series recorded
there would be a column of zeros. What is worth having is not the state but the event, and the age
above is that, derived on demand.

## Consequences

**Positive:**

- A drift alert can be triaged. "Wrong since yesterday" and "wrong since June" are different bugs.
- Every check's zero is now evidence, in the channel an agent reads rather than only in prose.
- One vocabulary across three checks, so a consumer needs no per-tool knowledge.

**Negative / trade-offs:**

- The age is an upper bound on the drift's age, not a measurement of it. The wording carries that
  caveat, and a reader who ignores the wording will over-read the number.
- Three checks must keep one shape in step. A fourth added later can quietly not emit it — the same
  drift this closes, one level up.
- One `git log` per drifted record. Bounded by the alert count, not the corpus size, which is what
  makes it affordable.

**Neutral / follow-up:**

- The history lookup takes a repository root as an argument rather than reading a module constant,
  so it can be tested against a purpose-built repository. A test that could only run against the
  shipped corpus could not pin the dates it asserts.

## References

- `docs/specs/decision-record-drift-history.md` — the spec this implements, §1 and §2.
- `packages/adr/git-history.ts` — the history lookup.
- `packages/adr/lib.ts` — `describeClaimAge`.
- `.github/workflows/ci.yml` — the `contents: read` token that rules out a stored ledger.
